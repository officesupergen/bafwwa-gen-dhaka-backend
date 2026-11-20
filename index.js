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

// Delete a tution
app.delete("/tutions/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid tution id" });
  }
  const result = await tutionsCollection.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Tution not found" });
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
