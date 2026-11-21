import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

// Database connection

const client = new MongoClient(process.env.MONGO_URI);

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
let database = connectedClient.db("mentor_lagbe_db");
let usersCollection = database.collection("user");
let tutionsCollection = database.collection("tutions");
let applicationsCollection = database.collection("applications");
let paymentsCollection = database.collection("payments");

// User registration endpoint

app.get("/users", async (req, res) => {
  const cursor = usersCollection.find({});
  const result = await cursor.toArray();
  res.json(result);
});

// Tution creation endpoint
app.get("/tutions", async (req, res) => {
  const cursor = tutionsCollection.find({});
  const result = await cursor.toArray();
  res.json(result);
});

// Count tuitions — no filter = every listing, `?tutorEmail=` = one tutor's posts
app.get("/tutions/count", async (req, res) => {
  const params = {};
  if (req.query.tutorEmail) {
    params.tutorEmail = String(req.query.tutorEmail);
  }
  const count = await tutionsCollection.countDocuments(params);
  res.json({ count });
});

app.post("/tutions", async (req, res) => {
  const tutionData = req.body;
  const result = await tutionsCollection.insertOne(tutionData);
  console.log("Inserted tution:", result);
  res.json(result);
});

// Fetch a single tution
app.get("/tutions/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid tution id" });
  }
  const tution = await tutionsCollection.findOne({ _id: new ObjectId(id) });
  if (!tution) {
    return res.status(404).json({ error: "Tution not found" });
  }
  res.json(tution);
});

// Update a tution (edit a listing, pause/activate, admin approval)
app.patch("/tutions/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid tution id" });
  }
  const { _id, ...updates } = req.body;
  const result = await tutionsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates },
  );
  if (!result.matchedCount) {
    return res.status(404).json({ error: "Tution not found" });
  }
  const tution = await tutionsCollection.findOne({ _id: new ObjectId(id) });
  res.json(tution);
});

// Delete a tution (and every application filed against it)
app.delete("/tutions/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid tution id" });
  }
  const result = await tutionsCollection.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Tution not found" });
  }
  await applicationsCollection.deleteMany({ tuitionId: id });
  res.json(result);
});

// Applications --------------------------------------------------------------

// Every application (the client filters by tutor/student email)
app.get("/applications", async (req, res) => {
  const cursor = applicationsCollection.find({});
  const result = await cursor.toArray();
  res.json(result);
});

// A student applies to a tuition: links tuitionId + tutorEmail + studentEmail
// with status "pending". The tuition document is the source of truth for the
// denormalised fields, and one application per student/tuition is enforced.
app.post("/applications", async (req, res) => {
  const {
    tuitionId,
    studentName,
    studentEmail,
    studentPhone,
    preferredSchedule,
    studentNote,
  } = req.body;
  if (!tuitionId || !studentEmail) {
    return res
      .status(400)
      .json({ error: "tuitionId and studentEmail are required" });
  }
  if (!ObjectId.isValid(tuitionId)) {
    return res.status(400).json({ error: "Invalid tution id" });
  }
  const tuition = await tutionsCollection.findOne({
    _id: new ObjectId(tuitionId),
  });
  if (!tuition) {
    return res.status(404).json({ error: "Tution not found" });
  }
  if (tuition.approvalStatus !== "approved") {
    return res
      .status(400)
      .json({ error: "This tuition is not open for applications." });
  }
  if (tuition.isActive === false) {
    return res
      .status(400)
      .json({ error: "This tuition is closed for applications." });
  }
  const existing = await applicationsCollection.findOne({
    tuitionId,
    studentEmail,
  });
  if (existing) {
    return res
      .status(409)
      .json({ error: "You have already applied for this tuition." });
  }
  const application = {
    tuitionId,
    tuitionTitle: tuition.title || "",
    subject: tuition.subject || "",
    monthlyFee: tuition.monthlyFee ?? 0,
    tutorEmail: tuition.tutorEmail || "",
    studentName: studentName || "",
    studentEmail,
    studentPhone: studentPhone || "",
    preferredSchedule: preferredSchedule || "",
    studentNote: studentNote || "",
    status: "pending",
    appliedAt: new Date().toISOString(),
  };
  const result = await applicationsCollection.insertOne(application);
  res.json({ ...application, _id: result.insertedId });
});

// Update an application (the tutor accepts or rejects it)
app.patch("/applications/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid application id" });
  }
  const { _id, tuitionId, appliedAt, ...updates } = req.body;
  const result = await applicationsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates },
  );
  if (!result.matchedCount) {
    return res.status(404).json({ error: "Application not found" });
  }
  const application = await applicationsCollection.findOne({
    _id: new ObjectId(id),
  });
  res.json(application);
});

// Delete an application (the student cancels it)
app.delete("/applications/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid application id" });
  }
  const result = await applicationsCollection.deleteOne({
    _id: new ObjectId(id),
  });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Application not found" });
  }
  res.json(result);
});

// Base Routes
app.get("/", (req, res) => {
  res.send("Hello, MentorLagbe!");
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Backend Server is running on port ${PORT}`);
});
