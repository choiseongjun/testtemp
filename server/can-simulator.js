const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: 8080 });

let speed = 0;
let input = "none"; // "gas", "brake", "hardbrake", "none"

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (msg) => {
    const cmd = msg.toString();
    if (["gas", "brake", "hardbrake", "none"].includes(cmd)) {
      input = cmd;
    }
  });

  let prevSpeed = 0;

  const interval = setInterval(() => {
    switch (input) {
      case "gas":
        speed += 3;
        break;
      case "brake":
        speed -= 4;
        break;
      case "hardbrake":
        speed -= 15;
        break;
      case "none":
        // 관성 감속
        speed -= 0.5;
        break;
    }

    speed = Math.max(0, Math.min(200, speed));
    speed = Math.round(speed * 10) / 10;

    const deceleration = Math.round((prevSpeed - speed) * 10) / 10;

    const phase =
      input === "gas"
        ? "accelerate"
        : input === "hardbrake"
          ? "sudden_stop"
          : input === "brake"
            ? "light_brake"
            : speed > 1
              ? "cruise"
              : "idle";

    const canData = {
      timestamp: Date.now(),
      speed,
      deceleration,
      phase,
    };

    ws.send(JSON.stringify(canData));
    prevSpeed = speed;
  }, 100);

  ws.on("close", () => {
    clearInterval(interval);
    speed = 0;
    input = "none";
    console.log("Client disconnected");
  });
});

console.log("CAN Simulator (Manual) running on ws://localhost:8080");
console.log("Controls: gas / brake / hardbrake / none");
