// index.js
const express = require("express");
const cors = require("cors");

const app = express();

require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;

// ================= Middleware =================
app.use(express.json());
app.use(cors());
// ================= MongoDB Connection =================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.9vhb7u9.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("garmentsDB");
    const productsCollection = db.collection("products");
    const usersCollection = db.collection("users");
    console.log("MongoDB connected successfully!");
    // ================= Firebase Token Verification Middleware =================
    const verifyFireBaseToken = async (req, res, next) => {
      const authorization = req.headers.authorization;
      if (!authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authorization.split(" ")[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.userEmail = decoded.email;
        next();
      } catch {
        return res.status(401).send({ message: "unauthorized access" });
      }
    };
    // ================= Users Routes =================
    // Save user to MongoDB after login/signup

    app.post("/users", verifyFireBaseToken, async (req, res) => {
      const { email, name, photoURL } = req.body;
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) return res.send({ message: "User already exists" });

      const newUser = {
        email,
        name,
        photoURL,
        role: "customer",
        suspended: false,
      };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });
    //--------Add Product--------
    app.post("/products", verifyFireBaseToken, async (req, res) => {
      const product = { ...req.body, managerEmail: req.userEmail };
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });
    //----------All Product---------
    app.get("/all-products", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const total = await productsCollection.countDocuments();
      const products = await productsCollection
        .find()
        .skip(skip)
        .limit(limit)
        .toArray();
      res.send({ products, total });
    });
    // ================= Home Test =================
    app.get("/", (req, res) => {
      res.send("Garments Order & Production Tracker Backend is running!");
    });

    console.log("Backend routes ready...");
  } finally {
    // MongoDB client stays connected to keep server alive
  }
}

run().catch(console.dir);

// ================= Start Server =================
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
