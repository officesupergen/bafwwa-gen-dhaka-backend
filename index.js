import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import Stripe from "stripe";

const app = express();
app.use(cors());
app.use(express.json());

// Stripe initialization
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");

// Database connection
const client = new MongoClient(process.env.MONGO_URI, {
  // Connection pool tuning — keeps latency flat under concurrent requests.
  minPoolSize: 5,
  maxPoolSize: 25,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  // Retry transient network errors instead of failing the request.
  retryWrites: true,
  retryReads: true,
});

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

let connectedClient = await connectToMongoDB();
let database = connectedClient.db("gen_dhaka_db");
let usersCollection = database.collection("users");
let academicRecordsCollection = database.collection("academic_records");
let attendanceCollection = database.collection("attendance");
let schedulesCollection = database.collection("schedules");
let feesPaymentsCollection = database.collection("fees_and_payments");

// Role-based middleware
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const userRole = req.headers["x-user-role"];
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    req.userRole = userRole;
    next();
  };
}

// Validation helpers
function validateObjectId(id, res) {
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: "Invalid ID format" });
    return false;
  }
  return true;
}

const SHIFTS = ["Morning", "Afternoon"];
const SECTION_TRACKS = ["English Medium", "English Version"];
const SESSION_CYCLES = ["Jul-Jun", "Jan-Dec"];
const ROLES = ["student", "teacher", "admin", "staff", "principal"];
const CLASS_NAMES = ["Playgroup", "Nursery-I", "Nursery-II", "KG"];
const ATTENDANCE_STATUS = ["Present", "Absent", "Late", "Leave"];
const PAYMENT_TYPES = ["Monthly Fee", "Admission", "Session Charge"];
const PAYMENT_STATUS = ["Paid", "Pending"];

// ==================== USERS ====================

// Get all users (with optional role filter)
app.get("/users", async (req, res) => {
  const { role, shift, sectionTrack } = req.query;
  const filter = {};
  if (role) filter.role = role;
  if (shift) filter.shift = shift;
  if (sectionTrack) filter.sectionTrack = sectionTrack;
  const cursor = usersCollection.find(filter);
  const result = await cursor.toArray();
  res.json(result);
});

// Get user by ID
app.get("/users/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const user = await usersCollection.findOne({ _id: new ObjectId(id) });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// Create user
app.post("/users", async (req, res) => {
  const { name, email, role, phone, profileImage, shift, sectionTrack } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ error: "name, email, role are required" });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  if (shift && !SHIFTS.includes(shift)) {
    return res.status(400).json({ error: "Invalid shift" });
  }
  if (sectionTrack && !SECTION_TRACKS.includes(sectionTrack)) {
    return res.status(400).json({ error: "Invalid sectionTrack" });
  }
  const existing = await usersCollection.findOne({ email });
  if (existing) {
    return res.status(409).json({ error: "Email already exists" });
  }
  const user = {
    name,
    email,
    role,
    phone: phone || "",
    profileImage: profileImage || "",
    shift: shift || "",
    sectionTrack: sectionTrack || "",
    createdAt: new Date().toISOString(),
  };
  const result = await usersCollection.insertOne(user);
  res.status(201).json({ ...user, _id: result.insertedId });
});

// Update user
app.patch("/users/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const { _id, createdAt, ...updates } = req.body;
  if (updates.role && !ROLES.includes(updates.role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  if (updates.shift && !SHIFTS.includes(updates.shift)) {
    return res.status(400).json({ error: "Invalid shift" });
  }
  if (updates.sectionTrack && !SECTION_TRACKS.includes(updates.sectionTrack)) {
    return res.status(400).json({ error: "Invalid sectionTrack" });
  }
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates }
  );
  if (!result.matchedCount) {
    return res.status(404).json({ error: "User not found" });
  }
  const user = await usersCollection.findOne({ _id: new ObjectId(id) });
  res.json(user);
});

// Delete user
app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json(result);
});

// ==================== ACADEMIC RECORDS ====================

// Get all academic records (with filters)
app.get("/academic-records", async (req, res) => {
  const { studentId, className, shift, sessionCycle, academicYear } = req.query;
  const filter = {};
  if (studentId) filter.studentId = studentId;
  if (className) filter.className = className;
  if (shift) filter.shift = shift;
  if (sessionCycle) filter.sessionCycle = sessionCycle;
  if (academicYear) filter.academicYear = academicYear;
  const cursor = academicRecordsCollection.find(filter);
  const result = await cursor.toArray();
  res.json(result);
});

// Get academic record by ID
app.get("/academic-records/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const record = await academicRecordsCollection.findOne({ _id: new ObjectId(id) });
  if (!record) return res.status(404).json({ error: "Academic record not found" });
  res.json(record);
});

// Create academic record
app.post("/academic-records", async (req, res) => {
  const { studentId, className, shift, sessionCycle, rollNumber, academicYear } = req.body;
  if (!studentId || !className || !shift || !sessionCycle || !rollNumber || !academicYear) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (!CLASS_NAMES.includes(className)) {
    return res.status(400).json({ error: "Invalid className" });
  }
  if (!SHIFTS.includes(shift)) {
    return res.status(400).json({ error: "Invalid shift" });
  }
  if (!SESSION_CYCLES.includes(sessionCycle)) {
    return res.status(400).json({ error: "Invalid sessionCycle" });
  }
  const student = await usersCollection.findOne({ _id: new ObjectId(studentId) });
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }
  if (student.role !== "student") {
    return res.status(400).json({ error: "User is not a student" });
  }
  const existing = await academicRecordsCollection.findOne({ studentId, academicYear, shift });
  if (existing) {
    return res.status(409).json({ error: "Academic record for this year/shift already exists" });
  }
  const record = {
    studentId,
    className,
    shift,
    sessionCycle,
    rollNumber,
    academicYear,
    createdAt: new Date().toISOString(),
  };
  const result = await academicRecordsCollection.insertOne(record);
  res.status(201).json({ ...record, _id: result.insertedId });
});

// Update academic record
app.patch("/academic-records/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const { _id, createdAt, studentId, ...updates } = req.body;
  if (updates.className && !CLASS_NAMES.includes(updates.className)) {
    return res.status(400).json({ error: "Invalid className" });
  }
  if (updates.shift && !SHIFTS.includes(updates.shift)) {
    return res.status(400).json({ error: "Invalid shift" });
  }
  if (updates.sessionCycle && !SESSION_CYCLES.includes(updates.sessionCycle)) {
    return res.status(400).json({ error: "Invalid sessionCycle" });
  }
  const result = await academicRecordsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates }
  );
  if (!result.matchedCount) {
    return res.status(404).json({ error: "Academic record not found" });
  }
  const record = await academicRecordsCollection.findOne({ _id: new ObjectId(id) });
  res.json(record);
});

// Delete academic record
app.delete("/academic-records/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const result = await academicRecordsCollection.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Academic record not found" });
  }
  res.json(result);
});

// ==================== ATTENDANCE ====================

// Get all attendance (with filters)
app.get("/attendance", async (req, res) => {
  const { userId, role, date, shift, status } = req.query;
  const filter = {};
  if (userId) filter.userId = userId;
  if (role) filter.role = role;
  if (date) filter.date = date;
  if (shift) filter.shift = shift;
  if (status) filter.status = status;
  const cursor = attendanceCollection.find(filter).sort({ date: -1 });
  const result = await cursor.toArray();
  res.json(result);
});

// Get attendance by ID
app.get("/attendance/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const record = await attendanceCollection.findOne({ _id: new ObjectId(id) });
  if (!record) return res.status(404).json({ error: "Attendance record not found" });
  res.json(record);
});

// Create attendance (bulk or single)
app.post("/attendance", async (req, res) => {
  const records = Array.isArray(req.body) ? req.body : [req.body];
  const validatedRecords = [];
  for (const record of records) {
    const { userId, role, date, shift, status, remarks } = record;
    if (!userId || !role || !date || !shift || !status) {
      return res.status(400).json({ error: "userId, role, date, shift, status are required" });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (!SHIFTS.includes(shift)) {
      return res.status(400).json({ error: "Invalid shift" });
    }
    if (!ATTENDANCE_STATUS.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ error: `User ${userId} not found` });
    }
    validatedRecords.push({
      userId,
      role,
      date,
      shift,
      status,
      remarks: remarks || "",
      createdAt: new Date().toISOString(),
    });
  }
  const result = await attendanceCollection.insertMany(validatedRecords);
  res.status(201).json({ insertedCount: result.insertedCount, ids: result.insertedIds });
});

// Update attendance
app.patch("/attendance/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const { _id, createdAt, ...updates } = req.body;
  if (updates.status && !ATTENDANCE_STATUS.includes(updates.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (updates.shift && !SHIFTS.includes(updates.shift)) {
    return res.status(400).json({ error: "Invalid shift" });
  }
  const result = await attendanceCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates }
  );
  if (!result.matchedCount) {
    return res.status(404).json({ error: "Attendance record not found" });
  }
  const record = await attendanceCollection.findOne({ _id: new ObjectId(id) });
  res.json(record);
});

// Delete attendance
app.delete("/attendance/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const result = await attendanceCollection.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Attendance record not found" });
  }
  res.json(result);
});

// Attendance report: daily summary by shift/class
app.get("/attendance/report/daily", async (req, res) => {
  const { date, shift } = req.query;
  if (!date) return res.status(400).json({ error: "date is required" });
  const filter = { date };
  if (shift) filter.shift = shift;
  const records = await attendanceCollection.find(filter).toArray();
  const summary = records.reduce((acc, r) => {
    const key = `${r.shift}-${r.role}`;
    acc[key] = acc[key] || { present: 0, absent: 0, late: 0, leave: 0, total: 0 };
    acc[key][r.status.toLowerCase()]++;
    acc[key].total++;
    return acc;
  }, {});
  res.json({ date, shift, summary });
});

// ==================== SCHEDULES ====================

// Get all schedules (with filters)
app.get("/schedules", async (req, res) => {
  const { className, shift, teacherId, dayOfWeek } = req.query;
  const filter = {};
  if (className) filter.className = className;
  if (shift) filter.shift = shift;
  if (teacherId) filter.teacherId = teacherId;
  if (dayOfWeek) filter.dayOfWeek = dayOfWeek;
  const cursor = schedulesCollection.find(filter).sort({ dayOfWeek: 1, startTime: 1 });
  const result = await cursor.toArray();
  res.json(result);
});

// Get schedule by ID
app.get("/schedules/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const schedule = await schedulesCollection.findOne({ _id: new ObjectId(id) });
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  res.json(schedule);
});

// Create schedule
app.post("/schedules", async (req, res) => {
  const { className, shift, subject, teacherId, startTime, endTime, roomNumber, dayOfWeek } = req.body;
  if (!className || !shift || !subject || !teacherId || !startTime || !endTime || !dayOfWeek) {
    return res.status(400).json({ error: "All fields except roomNumber are required" });
  }
  if (!CLASS_NAMES.includes(className)) {
    return res.status(400).json({ error: "Invalid className" });
  }
  if (!SHIFTS.includes(shift)) {
    return res.status(400).json({ error: "Invalid shift" });
  }
  const teacher = await usersCollection.findOne({ _id: new ObjectId(teacherId) });
  if (!teacher) {
    return res.status(404).json({ error: "Teacher not found" });
  }
  if (teacher.role !== "teacher") {
    return res.status(400).json({ error: "User is not a teacher" });
  }
  const schedule = {
    className,
    shift,
    subject,
    teacherId,
    startTime,
    endTime,
    roomNumber: roomNumber || "",
    dayOfWeek,
    createdAt: new Date().toISOString(),
  };
  const result = await schedulesCollection.insertOne(schedule);
  res.status(201).json({ ...schedule, _id: result.insertedId });
});

// Update schedule
app.patch("/schedules/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const { _id, createdAt, ...updates } = req.body;
  if (updates.className && !CLASS_NAMES.includes(updates.className)) {
    return res.status(400).json({ error: "Invalid className" });
  }
  if (updates.shift && !SHIFTS.includes(updates.shift)) {
    return res.status(400).json({ error: "Invalid shift" });
  }
  if (updates.teacherId) {
    const teacher = await usersCollection.findOne({ _id: new ObjectId(updates.teacherId) });
    if (!teacher || teacher.role !== "teacher") {
      return res.status(400).json({ error: "Invalid teacherId" });
    }
  }
  const result = await schedulesCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates }
  );
  if (!result.matchedCount) {
    return res.status(404).json({ error: "Schedule not found" });
  }
  const schedule = await schedulesCollection.findOne({ _id: new ObjectId(id) });
  res.json(schedule);
});

// Delete schedule
app.delete("/schedules/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const result = await schedulesCollection.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Schedule not found" });
  }
  res.json(result);
});

// ==================== FEES AND PAYMENTS ====================

// Get all fees/payments (with filters)
app.get("/fees", async (req, res) => {
  const { studentId, paymentType, sessionCycle, status } = req.query;
  const filter = {};
  if (studentId) filter.studentId = studentId;
  if (paymentType) filter.paymentType = paymentType;
  if (sessionCycle) filter.sessionCycle = sessionCycle;
  if (status) filter.status = status;
  const cursor = feesPaymentsCollection.find(filter).sort({ createdAt: -1 });
  const result = await cursor.toArray();
  res.json(result);
});

// Get fee/payment by ID
app.get("/fees/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const record = await feesPaymentsCollection.findOne({ _id: new ObjectId(id) });
  if (!record) return res.status(404).json({ error: "Fee record not found" });
  res.json(record);
});

// Create fee record
app.post("/fees", async (req, res) => {
  const { studentId, amount, paymentType, sessionCycle, status, transactionId } = req.body;
  if (!studentId || !amount || !paymentType || !sessionCycle || !status) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (!PAYMENT_TYPES.includes(paymentType)) {
    return res.status(400).json({ error: "Invalid paymentType" });
  }
  if (!SESSION_CYCLES.includes(sessionCycle)) {
    return res.status(400).json({ error: "Invalid sessionCycle" });
  }
  if (!PAYMENT_STATUS.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const student = await usersCollection.findOne({ _id: new ObjectId(studentId) });
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }
  if (student.role !== "student") {
    return res.status(400).json({ error: "User is not a student" });
  }
  const record = {
    studentId,
    amount: Number(amount),
    paymentType,
    sessionCycle,
    status,
    transactionId: transactionId || "",
    paidAt: status === "Paid" ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  };
  const result = await feesPaymentsCollection.insertOne(record);
  res.status(201).json({ ...record, _id: result.insertedId });
});

// Update fee record (e.g., mark as paid)
app.patch("/fees/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const { _id, createdAt, studentId, ...updates } = req.body;
  if (updates.paymentType && !PAYMENT_TYPES.includes(updates.paymentType)) {
    return res.status(400).json({ error: "Invalid paymentType" });
  }
  if (updates.sessionCycle && !SESSION_CYCLES.includes(updates.sessionCycle)) {
    return res.status(400).json({ error: "Invalid sessionCycle" });
  }
  if (updates.status && !PAYMENT_STATUS.includes(updates.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (updates.status === "Paid" && !updates.paidAt) {
    updates.paidAt = new Date().toISOString();
  }
  if (updates.amount) updates.amount = Number(updates.amount);
  const result = await feesPaymentsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates }
  );
  if (!result.matchedCount) {
    return res.status(404).json({ error: "Fee record not found" });
  }
  const record = await feesPaymentsCollection.findOne({ _id: new ObjectId(id) });
  res.json(record);
});

// Delete fee record
app.delete("/fees/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(id, res)) return;
  const result = await feesPaymentsCollection.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Fee record not found" });
  }
  res.json(result);
});

// Fee summary for a student
app.get("/fees/summary/:studentId", async (req, res) => {
  const { studentId } = req.params;
  if (!validateObjectId(studentId, res)) return;
  const records = await feesPaymentsCollection.find({ studentId }).toArray();
  const summary = records.reduce((acc, r) => {
    acc.total += r.amount;
    if (r.status === "Paid") acc.paid += r.amount;
    else acc.pending += r.amount;
    return acc;
  }, { total: 0, paid: 0, pending: 0 });
  res.json({ studentId, ...summary, records });
});

// ==================== STRIPE PAYMENTS ====================

// Create Stripe Checkout Session for fee payment
app.post("/payments/create-checkout-session", async (req, res) => {
  const { feeId, studentId, amount, paymentType, sessionCycle, successUrl, cancelUrl } = req.body;
  if (!feeId || !studentId || !amount) {
    return res.status(400).json({ error: "feeId, studentId, amount are required" });
  }
  const fee = await feesPaymentsCollection.findOne({ _id: new ObjectId(feeId) });
  if (!fee) {
    return res.status(404).json({ error: "Fee record not found" });
  }
  if (fee.status === "Paid") {
    return res.status(400).json({ error: "Fee already paid" });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: {
              name: `${paymentType || "School Fee"} - ${sessionCycle || ""}`,
              description: `Student: ${studentId}`,
            },
            unit_amount: Math.round(Number(amount) * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/payment/cancel`,
      metadata: {
        feeId,
        studentId,
        paymentType: paymentType || "",
        sessionCycle: sessionCycle || "",
      },
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Stripe webhook handler
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { feeId, studentId } = session.metadata;
    if (feeId) {
      await feesPaymentsCollection.updateOne(
        { _id: new ObjectId(feeId) },
        { $set: { status: "Paid", transactionId: session.payment_intent, paidAt: new Date().toISOString() } }
      );
      console.log(`Fee ${feeId} marked as paid for student ${studentId}`);
    }
  }
  res.json({ received: true });
});

// Verify payment status
app.get("/payments/verify/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      const { feeId } = session.metadata;
      if (feeId) {
        await feesPaymentsCollection.updateOne(
          { _id: new ObjectId(feeId) },
          { $set: { status: "Paid", transactionId: session.payment_intent, paidAt: new Date().toISOString() } }
        );
      }
      return res.json({ success: true, feeId });
    }
    res.json({ success: false });
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

// ==================== DASHBOARD STATS ====================

// Principal dashboard stats
app.get("/dashboard/principal", async (req, res) => {
  const [
    totalStudents,
    totalTeachers,
    totalAdmins,
    totalStaff,
    morningStudents,
    afternoonStudents,
  ] = await Promise.all([
    usersCollection.countDocuments({ role: "student" }),
    usersCollection.countDocuments({ role: "teacher" }),
    usersCollection.countDocuments({ role: "admin" }),
    usersCollection.countDocuments({ role: "staff" }),
    usersCollection.countDocuments({ role: "student", shift: "Morning" }),
    usersCollection.countDocuments({ role: "student", shift: "Afternoon" }),
  ]);
  const today = new Date().toISOString().split("T")[0];
  const todayAttendance = await attendanceCollection.find({ date: today }).toArray();
  const attendanceSummary = todayAttendance.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  res.json({
    enrollment: {
      total: totalStudents,
      morningShift: morningStudents,
      afternoonShift: afternoonStudents,
    },
    staff: {
      teachers: totalTeachers,
      admins: totalAdmins,
      supportingStaff: totalStaff,
      principal: 1,
    },
    todayAttendance: attendanceSummary,
  });
});

// Admin dashboard stats
app.get("/dashboard/admin", async (req, res) => {
  const [pendingFees, totalFees, recentPayments, totalStudents] = await Promise.all([
    feesPaymentsCollection.countDocuments({ status: "Pending" }),
    feesPaymentsCollection.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]).toArray(),
    feesPaymentsCollection.find({ status: "Paid" }).sort({ paidAt: -1 }).limit(10).toArray(),
    usersCollection.countDocuments({ role: "student" }),
  ]);
  res.json({
    pendingFeesCount: pendingFees,
    totalFeesCollected: totalFees[0]?.total || 0,
    recentPayments,
    totalStudents,
  });
});

// Teacher dashboard: class roster and schedule (optimized with aggregation)
app.get("/dashboard/teacher/:teacherId", async (req, res) => {
  const { teacherId } = req.params;
  const { page = 1, limit = 50, className } = req.query;
  if (!validateObjectId(teacherId, res)) return;

  const teacher = await usersCollection.findOne({ _id: new ObjectId(teacherId) });
  if (!teacher || teacher.role !== "teacher") {
    return res.status(404).json({ error: "Teacher not found" });
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const scheduleFilter = { teacherId };
  if (className) scheduleFilter.className = className;

  const [schedules, totalSchedules] = await Promise.all([
    schedulesCollection.find(scheduleFilter).sort({ dayOfWeek: 1, startTime: 1 }).skip(skip).limit(limitNum).toArray(),
    schedulesCollection.countDocuments(scheduleFilter),
  ]);

  const classNames = [...new Set(schedules.map(s => s.className))];

  const classStudents = {};
  if (classNames.length > 0) {
    const studentPipeline = [
      { $match: { className: { $in: classNames }, shift: teacher.shift } },
      {
        $lookup: {
          from: "users",
          localField: "studentId",
          foreignField: "_id",
          as: "student",
        },
      },
      { $unwind: "$student" },
      { $match: { "student.role": "student" } },
      {
        $project: {
          className: 1,
          student: { _id: 1, name: 1, email: 1, phone: 1, profileImage: 1 },
        },
      },
    ];

    const studentResults = await academicRecordsCollection.aggregate(studentPipeline).toArray();

    for (const result of studentResults) {
      if (!classStudents[result.className]) classStudents[result.className] = [];
      classStudents[result.className].push(result.student);
    }
  }

  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  res.json({
    teacher: { _id: teacher._id, name: teacher.name, shift: teacher.shift, sectionTrack: teacher.sectionTrack, profileImage: teacher.profileImage },
    schedules,
    classStudents,
    pagination: { page: pageNum, limit: limitNum, total: totalSchedules, totalPages: Math.ceil(totalSchedules / limitNum) },
  });
});

// Student dashboard
app.get("/dashboard/student/:studentId", async (req, res) => {
  const { studentId } = req.params;
  if (!validateObjectId(studentId, res)) return;
  const student = await usersCollection.findOne({ _id: new ObjectId(studentId) });
  if (!student || student.role !== "student") {
    return res.status(404).json({ error: "Student not found" });
  }
  const [academicRecord, attendance, fees, schedule] = await Promise.all([
    academicRecordsCollection.findOne({ studentId }),
    attendanceCollection.find({ userId: studentId }).sort({ date: -1 }).limit(30).toArray(),
    feesPaymentsCollection.find({ studentId }).toArray(),
    academicRecord ? schedulesCollection.find({ className: academicRecord.className, shift: academicRecord.shift }).sort({ dayOfWeek: 1, startTime: 1 }).toArray() : [],
  ]);
  res.json({ student, academicRecord, attendance, fees, schedule });
});

// Base Routes
app.get("/", (req, res) => {
  res.send("BAFWWA Shaheen School Management System API");
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Backend Server is running on port ${PORT}`);
});