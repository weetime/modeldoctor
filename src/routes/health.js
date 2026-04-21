const express = require("express");
const { exec } = require("child_process");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get("/check-vegeta", (req, res) => {
  exec("which vegeta", (error, stdout) => {
    if (error) {
      return res.json({
        installed: false,
        message: "Vegeta is not installed. Please install it first.",
        path: null,
      });
    }
    res.json({
      installed: true,
      message: "Vegeta is installed",
      path: stdout.trim(),
    });
  });
});

module.exports = router;
