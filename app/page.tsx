"use client";

import { useEffect, useRef, useState } from "react";

interface CanData {
  timestamp: number;
  speed: number;
  deceleration: number;
  phase: string;
  input: string;
}

type AdState = "normal" | "slosh" | "spill";

export default function Home() {
  const normalVideoRef = useRef<HTMLVideoElement>(null);
  const sloshVideoRef = useRef<HTMLVideoElement>(null);
  const spillVideoRef = useRef<HTMLVideoElement>(null);

  const [canData, setCanData] = useState<CanData>({
    timestamp: 0,
    speed: 0,
    deceleration: 0,
    phase: "idle",
    input: "none",
  });
  const [adState, setAdState] = useState<AdState>("normal");
  const [connected, setConnected] = useState(false);

  const adStateRef = useRef<AdState>("normal");
  const spillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function switchTo(state: AdState) {
    if (adStateRef.current === state) return;

    const prev = adStateRef.current;
    adStateRef.current = state;
    setAdState(state);

    // 이전 영상 pause
    if (prev === "normal") normalVideoRef.current?.pause();
    if (prev === "slosh") sloshVideoRef.current?.pause();
    if (prev === "spill") spillVideoRef.current?.pause();

    // 새 영상 play
    const videoRef =
      state === "normal"
        ? normalVideoRef
        : state === "slosh"
          ? sloshVideoRef
          : spillVideoRef;

    if (videoRef.current) {
      // spill은 항상 처음부터
      if (state === "spill") videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }

    // 복구 타이머 초기화
    if (spillTimerRef.current) {
      clearTimeout(spillTimerRef.current);
      spillTimerRef.current = null;
    }
  }

  const wsRef = useRef<WebSocket | null>(null);
  const speedRef = useRef(0);
  const inputRef = useRef<string>("none");

  // WebSocket 연결 (로컬 개발용)
  useEffect(() => {
    // Vercel 배포 환경에서는 WebSocket 서버가 없으므로 연결 시도하지 않음
    if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket("ws://localhost:8080");
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        const data: CanData = JSON.parse(event.data);
        setCanData(data);

        if (data.input === "hardbrake" && data.speed > 0) {
          switchTo("spill");
        } else if (data.input === "brake") {
          if (adStateRef.current !== "spill") {
            switchTo("slosh");
          }
        } else if (data.input === "gas") {
          switchTo("normal");
        } else {
          if (adStateRef.current === "slosh") {
            switchTo("normal");
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
      if (spillTimerRef.current) clearTimeout(spillTimerRef.current);
    };
  }, []);

  // 로컬 시뮬레이션 (WebSocket 없을 때)
  useEffect(() => {
    if (connected) return;

    const interval = setInterval(() => {
      const keys = keysRef.current;
      let currentInput = "none";

      if (keys.has(" ") || keys.has("ArrowDown")) {
        currentInput = "hardbrake";
      } else if (keys.has("s")) {
        currentInput = "brake";
      } else if (keys.has("ArrowUp") || keys.has("w")) {
        currentInput = "gas";
      }

      inputRef.current = currentInput;
      let speed = speedRef.current;

      // 속도 시뮬레이션
      if (currentInput === "gas") {
        speed = Math.min(120, speed + 2);
      } else if (currentInput === "brake") {
        speed = Math.max(0, speed - 3);
      } else if (currentInput === "hardbrake") {
        speed = Math.max(0, speed - 8);
      } else {
        // 관성 감속
        speed = Math.max(0, speed - 0.5);
      }

      speedRef.current = speed;
      const decel =
        currentInput === "hardbrake" ? 12 :
        currentInput === "brake" ? 5 : 0;

      const phase =
        currentInput === "gas" ? "accelerate" :
        currentInput === "hardbrake" ? "sudden_stop" :
        currentInput === "brake" ? "light_brake" :
        speed > 0 ? "cruise" : "idle";

      setCanData({
        timestamp: Date.now(),
        speed,
        deceleration: decel,
        phase,
        input: currentInput,
      });

      // 영상 전환
      if (currentInput === "hardbrake" && speed > 0) {
        switchTo("spill");
      } else if (currentInput === "brake") {
        if (adStateRef.current !== "spill") {
          switchTo("slosh");
        }
      } else if (currentInput === "gas") {
        switchTo("normal");
      } else {
        if (adStateRef.current === "slosh") {
          switchTo("normal");
        }
      }
    }, 50);

    return () => clearInterval(interval);
  }, [connected]);

  // 키보드 컨트롤
  const keysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // WebSocket 연결 시에만 서버로 입력 전송
    function sendInput() {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const keys = keysRef.current;
      if (keys.has(" ") || keys.has("ArrowDown")) {
        ws.send("hardbrake");
      } else if (keys.has("s")) {
        ws.send("brake");
      } else if (keys.has("ArrowUp") || keys.has("w")) {
        ws.send("gas");
      } else {
        ws.send("none");
      }
    }

    const inputInterval = setInterval(sendInput, 50);

    function onKeyDown(e: KeyboardEvent) {
      if (["ArrowUp", "ArrowDown", " ", "w", "s"].includes(e.key)) {
        e.preventDefault();
        keysRef.current.add(e.key);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      clearInterval(inputInterval);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // 초기 자동 재생
  useEffect(() => {
    normalVideoRef.current?.play().catch(() => {});
  }, []);

  const videoStyle = (state: AdState) => ({
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    opacity: adState === state ? 1 : 0,
    transition: "opacity 0.4s ease",
    zIndex: adState === state ? 1 : 0,
  });

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {/* 정상 광고 영상 */}
      <video
        ref={normalVideoRef}
        src="/coffee-normal.mp4"
        loop
        muted
        playsInline
        style={videoStyle("normal")}
      />

      {/* 출렁이는 영상 */}
      <video
        ref={sloshVideoRef}
        src="/coffee-slosh.mp4"
        loop
        muted
        playsInline
        style={videoStyle("slosh")}
      />

      {/* 쏟아지는 영상 */}
      <video
        ref={spillVideoRef}
        src="/coffee-spill.mp4"
        loop
        muted
        playsInline
        style={videoStyle("spill")}
      />

      {/* 급정거 텍스트 오버레이 */}
      {adState === "spill" && (
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: 0,
            right: 0,
            textAlign: "center",
            zIndex: 10,
            animation: "shake 0.3s infinite",
          }}
        >
          <h1
            style={{
              fontSize: "clamp(32px, 6vw, 72px)",
              fontWeight: "bold",
              color: "#ff4444",
              textShadow:
                "0 0 20px rgba(255,0,0,0.5), 0 2px 10px rgba(0,0,0,0.8)",
              fontFamily: "'Arial Black', sans-serif",
            }}
          >
            HOLD YOUR COFFEE!
          </h1>
        </div>
      )}

      {/* 하단 HUD */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "16px 24px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
          zIndex: 10,
        }}
      >
        {/* 감속도 바 */}
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            margin: "0 auto 8px",
            height: 4,
            background: "#333",
            borderRadius: 2,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (canData.deceleration / 15) * 100)}%`,
              background:
                canData.deceleration > 8
                  ? "#ff4444"
                  : canData.deceleration > 2
                    ? "#ffaa00"
                    : "#00ff88",
              borderRadius: 2,
              transition: "width 0.1s",
            }}
          />
        </div>

        <div style={{ textAlign: "center" }}>
          <span
            style={{
              fontSize: "clamp(24px, 4vw, 40px)",
              fontWeight: "bold",
              fontFamily: "'Courier New', monospace",
              color:
                adState === "spill"
                  ? "#ff4444"
                  : adState === "slosh"
                    ? "#ffaa00"
                    : "#00ff88",
            }}
          >
            {canData.speed.toFixed(0)} km/h
          </span>
          <span
            style={{
              display: "block",
              fontSize: 13,
              color: "#888",
              marginTop: 4,
            }}
          >
            {adState === "spill"
              ? "급정거!"
              : adState === "slosh"
                ? "감속 중 - 커피 출렁임"
                : {
                    accelerate: "가속 중",
                    cruise: "정속 주행",
                    cruise2: "정속 주행",
                    light_brake: "살짝 브레이크",
                    recover: "재가속",
                    sudden_stop: "급정거!",
                    idle: "정차",
                  }[canData.phase] || canData.phase}
          </span>
        </div>
      </div>

      {/* 조작 버튼 */}
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 120,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          zIndex: 20,
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <button
          onMouseDown={() => keysRef.current.add("w")}
          onMouseUp={() => keysRef.current.delete("w")}
          onMouseLeave={() => keysRef.current.delete("w")}
          onTouchStart={(e) => { e.preventDefault(); keysRef.current.add("w"); }}
          onTouchEnd={() => keysRef.current.delete("w")}
          onTouchCancel={() => keysRef.current.delete("w")}
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "3px solid #00ff88",
            background: "rgba(0,255,136,0.15)",
            color: "#00ff88",
            fontSize: 28,
            fontWeight: "bold",
            cursor: "pointer",
            touchAction: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          GAS
        </button>
        <button
          onMouseDown={() => keysRef.current.add("s")}
          onMouseUp={() => keysRef.current.delete("s")}
          onMouseLeave={() => keysRef.current.delete("s")}
          onTouchStart={(e) => { e.preventDefault(); keysRef.current.add("s"); }}
          onTouchEnd={() => keysRef.current.delete("s")}
          onTouchCancel={() => keysRef.current.delete("s")}
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "3px solid #ffaa00",
            background: "rgba(255,170,0,0.15)",
            color: "#ffaa00",
            fontSize: 20,
            fontWeight: "bold",
            cursor: "pointer",
            touchAction: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          BRAKE
        </button>
        <button
          onMouseDown={() => keysRef.current.add(" ")}
          onMouseUp={() => keysRef.current.delete(" ")}
          onMouseLeave={() => keysRef.current.delete(" ")}
          onTouchStart={(e) => { e.preventDefault(); keysRef.current.add(" "); }}
          onTouchEnd={() => keysRef.current.delete(" ")}
          onTouchCancel={() => keysRef.current.delete(" ")}
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "3px solid #ff4444",
            background: "rgba(255,68,68,0.15)",
            color: "#ff4444",
            fontSize: 13,
            fontWeight: "bold",
            cursor: "pointer",
            touchAction: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1.2,
            textAlign: "center",
          }}
        >
          HARD<br/>BRAKE
        </button>
      </div>

      {/* 연결 상태 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 16,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: connected ? "#00ff88" : "#aaaaff",
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: connected ? "#00ff88" : "#aaaaff",
          }}
        />
        {connected ? "CAN Connected" : "Local Mode"}
      </div>

      <style jsx>{`
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-5px) translateY(2px);
          }
          75% {
            transform: translateX(5px) translateY(-2px);
          }
        }
      `}</style>
    </div>
  );
}
