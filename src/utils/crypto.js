const crypto = require("crypto");

function randomKey(len = 32) {
  return crypto.randomBytes(len).toString("hex");
}

module.exports = { randomKey };
