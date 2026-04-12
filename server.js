require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const { GridFSBucket } = require("mongodb");

const { encrypt, decrypt } = require("./utils/encryption");
const authMiddleware = require("./middleware/authMiddleware");
const authRoutes = require("./routes/authRoutes");

const app = express();

app.use(cors());
app.use(express.json());

/* ================= ENV ================= */
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MongoDB URI not found in .env");
  process.exit(1);
}

/* ================= DB CONNECTION ================= */
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ DB Error:", err));

const conn = mongoose.connection;

let bucket;

conn.once("open", () => {
  bucket = new GridFSBucket(conn.db, { bucketName: "uploads" });
  console.log("✅ GridFS Ready");
});

/* ================= AUTH ROUTES ================= */

app.use("/api", authRoutes);

/* ================= MULTER ================= */

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
});

/* ================= UPLOAD ================= */

app.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!bucket) return res.status(500).json({ message: "DB not ready" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const uniqueName = Date.now() + "-" + req.file.originalname;

    const uploadStream = bucket.openUploadStream(uniqueName, {
      metadata: {
        title: encrypt(req.body.title),
        description: encrypt(req.body.description),
        uploadedAt: new Date(),
        contentType: req.file.mimetype,
      },
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on("finish", () => {
      res.status(201).json({
        message: "File uploaded successfully",
        fileId: uploadStream.id,
      });
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= GET FILES ================= */

app.get("/files", authMiddleware, async (req, res) => {
  try {

    const files = await conn.db
      .collection("uploads.files")
      .find()
      .sort({ uploadDate: -1 })
      .toArray();

    const decryptedFiles = files.map((file) => {

      if (file.metadata) {

        try {
          file.metadata.title = decrypt(file.metadata.title);
        } catch {}

        try {
          file.metadata.description = decrypt(file.metadata.description);
        } catch {}

      }

      return file;
    });

    res.json(decryptedFiles);

  } catch (error) {
    console.error("FILES API ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

/* ================= EDIT FILE METADATA ================= */

app.put("/files/:id", authMiddleware, upload.none(), async (req, res) => {
  try {

    const fileId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).json({ message: "Invalid file ID" });
    }

    const title = req.body.title;
    const description = req.body.description;

    const updateData = {};

    if (title) {
      updateData["metadata.title"] = encrypt(title);
    }

    if (description) {
      updateData["metadata.description"] = encrypt(description);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const result = await conn.db.collection("uploads.files").updateOne(
      { _id: new mongoose.Types.ObjectId(fileId) },
      { $set: updateData }
    );

    if (!result.matchedCount) {
      return res.status(404).json({ message: "File not found" });
    }

    res.json({ message: "File updated successfully" });

  } catch (error) {

    console.error("EDIT API ERROR:", error);

    res.status(500).json({
      message: "Update failed",
      error: error.message
    });

  }
});
/* ================= VIEW FILE ================= */

app.get("/files/view/:id", async (req, res) => {
  try {

    if (!bucket) return res.status(500).json({ message: "DB not ready" });

    const file = await conn.db
      .collection("uploads.files")
      .findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });

    if (!file) return res.status(404).json({ message: "File not found" });

    const contentType =
      file.metadata?.contentType ||
      file.contentType ||
      "application/octet-stream";

    res.set({
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${file.filename}"`,
    });

    bucket.openDownloadStream(file._id).pipe(res);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= DOWNLOAD ================= */

app.get("/files/download/:id", authMiddleware, async (req, res) => {
  try {

    if (!bucket) return res.status(500).json({ message: "DB not ready" });

    const file = await conn.db
      .collection("uploads.files")
      .findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });

    if (!file) return res.status(404).json({ message: "File not found" });

    const contentType =
      file.metadata?.contentType || "application/octet-stream";

    res.set({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    });

    bucket.openDownloadStream(file._id).pipe(res);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= DELETE ================= */

app.delete("/files/:id", authMiddleware, async (req, res) => {
  try {

    if (!bucket) return res.status(500).json({ message: "DB not ready" });

    await bucket.delete(new mongoose.Types.ObjectId(req.params.id));

    res.json({ message: "File deleted successfully" });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= SERVER ================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});