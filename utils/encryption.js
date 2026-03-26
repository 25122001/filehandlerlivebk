const crypto = require("crypto");

const algorithm = "aes-256-cbc";
const key = crypto.createHash("sha256").update(process.env.SECRET_KEY).digest();
const ivLength = 16;

/* ================= ENCRYPT ================= */
function encrypt(text) {
  const iv = crypto.randomBytes(ivLength);

  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return iv.toString("hex") + ":" + encrypted;
}


/* ================= DECRYPT ================= */
function decrypt(text) {
  const parts = text.split(":");

  const iv = Buffer.from(parts.shift(), "hex");
  const encryptedText = parts.join(":");

  const decipher = crypto.createDecipheriv(algorithm, key, iv);

  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

module.exports = { encrypt, decrypt };