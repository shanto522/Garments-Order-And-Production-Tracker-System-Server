// index.js
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const app = express();
const bcrypt = require("bcrypt");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const admin = require("firebase-admin");
// ================= Firebase Admin Initialization =================
const serviceAccount = require("./garments-order-tracker-client-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    const ordersCollection = db.collection("orders");
    const usersCollection = db.collection("users");
    const feedbacksCollection = db.collection("feedbacks");
    console.log("MongoDB connected successfully!");

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
    app.get("/home-products", async (req, res) => {
      try {
        const products = await productsCollection
          .find({ showOnHome: true }) // only selected for home
          .limit(6) // only 6 products
          .toArray();
        res.send(products);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch home products" });
      }
    });
    app.post("/products", verifyFireBaseToken, async (req, res) => {
      const product = { ...req.body, managerEmail: req.userEmail };
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

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

    app.get("/products/:id", async (req, res) => {
      const product = await productsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!product)
        return res.status(404).send({ message: "Product not found" });
      res.send(product);
    });
    app.get("/my-orders", async (req, res) => {
      const { email, page = 1, limit = 10 } = req.query;
      const skip = (page - 1) * limit;

      const total = await ordersCollection.countDocuments({ userEmail: email });
      const orders = await ordersCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .toArray();

      res.send({ orders, total });
    });

    app.put("/cancel-order/:id", verifyFireBaseToken, async (req, res) => {
      const order = await ordersCollection.findOne({
        _id: new ObjectId(req.params.id),
        userEmail: req.userEmail,
      });
      if (!order) return res.status(404).send({ message: "Order not found" });
      if (order.status !== "Pending")
        return res
          .status(400)
          .send({ message: "Only pending orders can be canceled" });

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: "Canceled", canceledAt: new Date() } }
      );
      res.send(result);
    });
    app.get("/orders/pending", verifyFireBaseToken, async (req, res) => {
      const orders = await ordersCollection
        .find({ status: "Pending" })
        .toArray();
      res.send(orders);
    });

    app.get("/orders/approved", verifyFireBaseToken, async (req, res) => {
      try {
        const orders = await ordersCollection
          .find({ status: "Approved" })
          .toArray();
        res.send(orders);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch approved orders" });
      }
    });

    app.put("/orders/:id", verifyFireBaseToken, async (req, res) => {
      const { status, trackingStage } = req.body;
      const updateData = {};

      if (status) updateData.status = status;
      if (trackingStage) {
        const order = await ordersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        const existingTracking = order.tracking || [];
        updateData.tracking = [...existingTracking, trackingStage];
      }
      if (status === "Approved") updateData.approvedAt = new Date();

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updateData }
      );

      res.send(result);
    });
    app.get("/products", verifyFireBaseToken, async (req, res) => {
      const products = await productsCollection.find().toArray();
      res.send(products);
    });
    app.put("/products/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const product = await productsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!product)
        return res.status(404).send({ message: "Product not found" });
      if (
        req.userRole === "manager" &&
        product.managerEmail !== req.userEmail
      ) {
        return res
          .status(403)
          .send({ message: "Cannot edit other manager's product" });
      }
      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body }
      );
      res.send(result);
    });
    app.delete("/products/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const product = await productsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!product)
        return res.status(404).send({ message: "Product not found" });
      if (
        req.userRole === "manager" &&
        product.managerEmail !== req.userEmail
      ) {
        return res
          .status(403)
          .send({ message: "Cannot delete other manager's product" });
      }
      const result = await productsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    app.get("/orders", verifyFireBaseToken, async (req, res) => {
      const query = {};
      if (req.query.status) query.status = req.query.status;
      const orders = await ordersCollection.find(query).toArray();
      res.send(orders);
    });
    app.get("/profile", verifyFireBaseToken, async (req, res) => {
      try {
        const email = req.userEmail;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        res.send({
          name: user.name,
          email: user.email,
          role: user.role || "Customer",
          photoURL: user.photoURL || "",
          status: user.suspended ? "Suspended" : "Active",
          suspendFeedback: user.suspendReason || "",
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch profile" });
      }
    });
    app.get("/users", verifyFireBaseToken, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });
    app.put("/users/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const { role, suspended, suspendReason } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role, suspended, suspendReason: suspendReason || "" } }
      );
      res.send(result);
    });
    app.delete("/users/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    app.delete("/orders/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await ordersCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    app.put("/orders/:id/status", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body; // Pending / Approved / Rejected
      const approvedAt = status === "Approved" ? new Date() : null;

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, approvedAt } }
      );
      res.send(result);
    });
    app.put("/orders/:id/progress", async (req, res) => {
      const { stage, currentLocation } = req.body;
      const orderId = req.params.id;

      if (!ObjectId.isValid(orderId))
        return res.status(400).send({ message: "Invalid order ID" });

      const order = await ordersCollection.findOne({
        _id: new ObjectId(orderId),
      });
      if (!order) return res.status(404).send({ message: "Order not found" });

      const updatedTracking = order.tracking || [];
      const updatedTrackingDates = order.trackingDates || {};

      if (
        stage &&
        stage !== "LocationUpdate" &&
        !updatedTracking.includes(stage)
      ) {
        updatedTracking.push(stage);
        updatedTrackingDates[stage] = new Date();
      }

      const updateData = {
        tracking: updatedTracking,
        trackingDates: updatedTrackingDates,
      };
      if (currentLocation) updateData.currentLocation = currentLocation;

      await ordersCollection.updateOne(
        { _id: new ObjectId(orderId) },
        { $set: updateData }
      );
      res.send({ message: "Order updated successfully!" });
    });

    app.get("/track-order/:orderId", verifyFireBaseToken, async (req, res) => {
      const { orderId } = req.params;
      if (!ObjectId.isValid(orderId))
        return res.status(400).send({ message: "Invalid order ID" });

      const order = await ordersCollection.findOne({
        _id: new ObjectId(orderId),
        userEmail: req.userEmail, // only owner can see
      });

      if (!order) return res.status(404).send({ message: "Order not found" });

      res.send(order);
    });
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { productId, productName, cost, senderEmail, metadata } =
          req.body;
        const amount = Number(cost) * 100; // Stripe expects cents
        const domain = process.env.SITE_DOMAIN || "http://localhost:5173";

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: productName },
                unit_amount: amount,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: senderEmail,
          metadata, // save order info for after payment
          success_url: `${domain}/dashboard/payment-success`,
          cancel_url: `${domain}/dashboard/payment-cancel`,
        });

        res.status(200).send({ url: session.url });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to create Stripe session" });
      }
    });
    // Order paid after success
    app.put("/order-paid/:id", async (req, res) => {
      const orderId = req.params.id;

      await ordersCollection.updateOne(
        { _id: new ObjectId(orderId) },
        {
          $set: {
            paymentStatus: "Paid",
            paidAt: new Date(),
          },
        }
      );

      res.send({ message: "Order marked as paid" });
    });
    app.post("/book-product", verifyFireBaseToken, async (req, res) => {
      const data = req.body;
      const newOrder = {
        productId: data.productId,
        productName: data.productName,
        price: data.price,
        quantity: data.quantity,
        orderPrice: data.orderPrice,
        userEmail: data.userEmail,
        userName: data.userName,
        firstName: data.firstName,
        lastName: data.lastName,
        contactNumber: data.contactNumber,
        deliveryAddress: data.deliveryAddress,
        notes: data.notes,
        paymentOption: data.paymentOption,
        status: "Pending",
        orderDate: new Date(),
        createdAt: new Date(),
      };
      const result = await ordersCollection.insertOne(newOrder);
      res.send(result);
    });
    app.post("/book-product/:id", verifyFireBaseToken, async (req, res) => {
      try {
        const productId = req.params.id;
        const product = await productsCollection.findOne({
          _id: new ObjectId(productId),
        });
        if (!product)
          return res.status(404).send({ message: "Product not found" });

        const booking = {
          productId,
          productName: product.name,
          userEmail: req.userEmail,
          quantity: req.body.quantity || 1,
          status: "Pending",
          paymentOption: req.body.paymentOption || "Cash on Delivery",
          bookedAt: new Date(),
        };

        const result = await ordersCollection.insertOne(booking);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to book product" });
      }
    });

    app.post("/orders/payment-success", async (req, res) => {
      try {
        const {
          productId,
          productName,
          quantity,
          orderPrice,
          firstName,
          lastName,
          contactNumber,
          deliveryAddress,
          notes,
          userEmail,
          paymentOption, // dynamic
          stripeSessionId, // 🔥 prevent duplicate
        } = req.body;

        if (
          !productId ||
          !productName ||
          !quantity ||
          !orderPrice ||
          !userEmail
        ) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        // Duplicate prevention using stripeSessionId
        if (stripeSessionId) {
          const existingOrder = await ordersCollection.findOne({
            stripeSessionId,
          });
          if (existingOrder) {
            return res.send({ success: true, orderId: existingOrder._id });
          }
        }

        const newOrder = {
          productId,
          productName,
          quantity,
          orderPrice,
          firstName,
          lastName,
          contactNumber,
          deliveryAddress,
          notes,
          userEmail,
          paymentOption: paymentOption || "Cash on Delivery",
          status: "Pending",
          paymentStatus: "Paid",
          orderDate: new Date(),
          createdAt: new Date(),
          paidAt: new Date(),
          stripeSessionId: stripeSessionId || null,
        };

        const result = await ordersCollection.insertOne(newOrder);
        res.send({ success: true, orderId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to create order" });
      }
    });
    app.post("/feedbacks", verifyFireBaseToken, async (req, res) => {
      const { name, message } = req.body;
      if (!name || !message)
        return res.status(400).send({ message: "All fields required" });

      try {
        const result = await feedbacksCollection.insertOne({
          name,
          message,
          createdAt: new Date(),
        });
        res.send({ success: true, id: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to save feedback" });
      }
    });
    app.get("/feedbacks", async (req, res) => {
      const limit = parseInt(req.query.limit) || 0; // 0 = all
      try {
        const feedbacks = await feedbacksCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();
        res.send(feedbacks);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch feedbacks" });
      }
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
