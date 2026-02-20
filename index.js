const express = require("express");
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Crypto Risk API Server Running");
});

app.post("/api/risk", (req, res) => {
  // 나중에 리스크 로직 여기에 넣을 예정
  res.json({ risk: "UNDER DEVELOPMENT" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on port", port));
