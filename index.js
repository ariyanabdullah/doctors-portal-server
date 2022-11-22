const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;

const stripe = require("stripe")(process.env.STRIPE_KEY);

// midleware

app.use(cors());
app.use(express.json());

const verifyJwt = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send("unauthorize access");
  }

  jwt.verify(authHeader, process.env.TOKEN_SECRET, function (err, decoded) {
    if (err) {
      console.log(err);
      return res.status(401).send("unauthorize access");
    }

    req.decoded = decoded;
    next();
  });
};

// mongodb

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster1.evach3k.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    // database collection

    const servicesCollection = client
      .db("doctorsportal")
      .collection("allservices");

    // booking collection

    const bookingCollection = client.db("doctorsportal").collection("bookings");

    const userCollection = client.db("doctorsportal").collection("users");
    const doctorCollection = client.db("doctorsportal").collection("doctors");
    const paymentCollection = client.db("doctorsportal").collection("payment");

    /// get all services

    // Note: you have to use verifyAdmin after using verifyJwt

    const verifyAdmin = async (req, res, next) => {
      const decodeEmail = req.decoded.email;
      const filter = { email: decodeEmail };
      const user = await userCollection.findOne(filter);

      if (user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    // problem solved

    app.get("/services", async (req, res) => {
      const date = req.query.date;

      const query = {};
      const cursor = servicesCollection.find(query);
      const result = await cursor.toArray(); // get all services

      const bookingQuery = { treatmentDate: date };

      const alreadyBooked = bookingCollection.find(bookingQuery);
      const Booked = await alreadyBooked.toArray(); // get all booking by date

      result.forEach((option) => {
        //option is like a single service
        const getOpt = Booked.filter((b) => b.treatmentName === option.name); // get all booked by service name
        const getTime = getOpt.map((opt) => opt.time);
        const remaning = option.slots.filter((slot) => !getTime.includes(slot));
        option.slots = remaning;
      });

      res.send(result);
    });

    // get single services

    app.get("/servicesSpecial", async (req, res) => {
      const query = {};

      const cursor = await servicesCollection
        .find(query)
        .project({ name: 1 })
        .toArray();

      res.send(cursor);
    });

    // get method for bookings

    app.get("/bookings", verifyJwt, async (req, res) => {
      const decodeEmail = req.decoded.email;

      const email = req.query.email;

      if (email !== decodeEmail) {
        return res.status(403).send({ message: "forbidden Error" });
      }
      const query = { email: email };
      const cursor = bookingCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get method for single booking

    app.get("/dashboard/checkout/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: ObjectId(id) };

      const result = await bookingCollection.findOne(query);

      res.send(result);
    });

    // post method

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        treatmentDate: booking.treatmentDate,
        email: booking.email,
        treatmentName: booking.treatmentName,
      };
      const Booked = bookingCollection.find(query);
      const alreadyBooked = await Booked.toArray();
      if (alreadyBooked.length) {
        const message = `You have Booked in ${booking.treatmentDate}`;
        return res.send({ acknowledged: false, message });
      }
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    // get method by user email

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const admin = await userCollection.findOne(query);
      res.send({ IsAdmin: admin?.role === "admin" });
    });

    // put method for making admin
    app.put("/users/:id", verifyJwt, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const options = { upsert: true };

      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await userCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // get method for user

    app.get("/users", async (req, res) => {
      const query = {};
      const cursor = userCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // post method for user

    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Post method for Doctors

    app.post("/doctors", verifyJwt, verifyAdmin, async (req, res) => {
      const doctor = req.body;

      const result = await doctorCollection.insertOne(doctor);

      res.send(result);
    });

    // get all Doctors

    app.get("/doctors", verifyJwt, verifyAdmin, async (req, res) => {
      const query = {};
      const cursor = doctorCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // delete a doctor

    app.delete("/doctors/:id", verifyJwt, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };

      const cursor = await doctorCollection.deleteOne(query);

      res.send(cursor);
    });

    // jwt api

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.TOKEN_SECRET, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }

      return res.status(401).send({ accessToken: "" });
    });

    // payment data here

    app.post("/payment", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionid,
        },
      };

      const updateResult = await bookingCollection.updateOne(filter, updateDoc);

      res.send(result);
    });

    // stripe api here
    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;

      const price = booking.price;
      const amount = price * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
  } finally {
  }
}

run().catch((err) => console.log(err));

// data
app.get("/", async (req, res) => {
  res.send("wellcome to Doctors portal server");
});

app.listen(port, () => {
  console.log("server is running ");
});
