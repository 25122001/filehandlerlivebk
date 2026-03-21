/* ================= SETUP ================= */
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const { GridFSBucket } = require("mongodb");

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

/* ================= MULTER ================= */
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

/* ================= UPLOAD ================= */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!bucket) return res.status(500).json({ message: "DB not ready" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const uniqueName = Date.now() + "-" + req.file.originalname;

    const uploadStream = bucket.openUploadStream(uniqueName, {
      metadata: {
        title: req.body.title,
        description: req.body.description,
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

/* ================= GET ALL FILES ================= */
app.get("/files", async (req, res) => {
  try {
    const files = await conn.db
      .collection("uploads.files")
      .find()
      .sort({ uploadDate: -1 })
      .toArray();

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= VIEW / DOWNLOAD ================= */
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

    const range = req.headers.range;

    /* ===== VIDEO STREAM ===== */
    if (contentType.startsWith("video") && range) {
      const videoSize = file.length;
      const CHUNK_SIZE = 10 ** 6;

      const start = Number(range.replace(/\D/g, ""));
      const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
      const contentLength = end - start + 1;

      res.status(206).set({
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": contentLength,
        "Content-Type": contentType,
      });

      bucket
        .openDownloadStream(file._id, { start, end: end + 1 })
        .pipe(res);
    } else {
      res.set({
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${file.filename}"`,
      });

      bucket.openDownloadStream(file._id).pipe(res);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= DELETE ================= */
app.delete("/files/:id", async (req, res) => {
  try {
    if (!bucket) return res.status(500).json({ message: "DB not ready" });

    await bucket.delete(new mongoose.Types.ObjectId(req.params.id));
    res.json({ message: "File deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= UPDATE (FIXED) ================= */
app.put("/files/:id", upload.single("file"), async (req, res) => {
  try {
    if (!bucket) return res.status(500).json({ message: "DB not ready" });

    const fileId = new mongoose.Types.ObjectId(req.params.id);

    const existingFile = await conn.db
      .collection("uploads.files")
      .findOne({ _id: fileId });

    if (!existingFile)
      return res.status(404).json({ message: "File not found" });

    /* ===== IF NEW FILE PROVIDED ===== */
    if (req.file) {
      // delete old file
      await bucket.delete(fileId);

      const uniqueName = Date.now() + "-" + req.file.originalname;

      const uploadStream = bucket.openUploadStream(uniqueName, {
        metadata: {
          title: req.body.title,
          description: req.body.description,
          uploadedAt: new Date(),
          contentType: req.file.mimetype,
        },
      });

      uploadStream.end(req.file.buffer);

      uploadStream.on("finish", () => {
        res.json({
          message: "File replaced successfully",
          newFileId: uploadStream.id,
        });
      });
    } else {
      /* ===== ONLY METADATA UPDATE ===== */
      await conn.db.collection("uploads.files").updateOne(
        { _id: fileId },
        {
          $set: {
            "metadata.title": req.body.title,
            "metadata.description": req.body.description,
          },
        }
      );

      res.json({ message: "Metadata updated successfully" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================= SERVER ================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});