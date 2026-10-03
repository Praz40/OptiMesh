"use client";

import { useEffect, useState } from "react";
import { deviceTopics, esp32ConfigLines, exampleTelemetry, uuid4 } from "@/lib/connect";
import type { OwnedDevice } from "@/lib/registry";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 2000);
    return () => clearTimeout(timer);
  }, [result]);

  async function copy() {
    try {
      // Undefined outside a secure context (e.g. http://<LAN IP>:3000); the text can still be selected.
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }

  return (
    <button type="button" className="button-small" aria-label={`Копирай ${label}`} onClick={() => void copy()}>
      {result === "copied" ? "Копирано" : result === "failed" ? "Маркирайте и копирайте" : "Копирай"}
    </button>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
        <CopyButton text={value} label={label} />
      </dd>
    </div>
  );
}

/** How to connect one device: identifiers, MQTT topics, a valid telemetry message and the ESP32 config lines. */
export function DeviceConnect({
  device,
  messageId,
  observedAt,
  onNewExample,
}: {
  device: OwnedDevice;
  messageId: string;
  observedAt: Date;
  onNewExample?: () => void;
}) {
  const topics = deviceTopics(device.site_id, device.id);
  const telemetry = JSON.stringify(exampleTelemetry(device, messageId, observedAt), null, 2);
  const esp32 = esp32ConfigLines(device.site_id, device.id);

  return (
    <div className="connect">
      <dl>
        <Value label="ID на обекта (SITE_ID)" value={device.site_id} />
        <Value label="ID на устройството (DEVICE_ID)" value={device.id} />
      </dl>

      <h4>MQTT теми</h4>
      <dl>
        <Value label="Телеметрия: устройство → OptiMesh" value={topics.telemetry} />
        <Value label="Команди: OptiMesh → устройство" value={topics.command} />
        <Value label="Потвърждения (ack): устройство → OptiMesh" value={topics.ack} />
      </dl>
      <p className="muted">
        Брокерът на шлюза (Raspberry Pi) пуска устройството само ако има ACL за тези теми: публикуване в telemetry и
        ack и абониране за command (docs/raspberry-pi-mqtt.md).
      </p>

      <h4>Примерна телеметрия</h4>
      <pre className="code-block">
        <code>{telemetry}</code>
      </pre>
      <div className="form-actions">
        <CopyButton text={telemetry} label="примерната телеметрия" />
        {onNewExample && (
          <button type="button" className="button-small" onClick={onNewExample}>
            Нов пример
          </button>
        )}
      </div>
      <p className="muted">
        Изпращайте на 2–5 s, всеки път с нов message_id и текущо observed_at (UTC). За проба без MQTT: POST
        /api/v1/telemetry със същото съобщение.
      </p>

      <h4>ESP32</h4>
      <pre className="code-block">
        <code>{esp32}</code>
      </pre>
      <div className="form-actions">
        <CopyButton text={esp32} label="редовете за ESP32" />
      </div>
      <p className="muted">
        Във firmware/esp32-telemetry/include/config.local.h (копие на config.example.h), на мястото на SITE_ID и
        DEVICE_ID.
      </p>

      {device.source === "simulator" && (
        <p className="notice" data-tone="info">
          Симулаторът на устройства (python -m app.simulator) зарежда устройствата при старт. Рестартирайте го и това
          устройство ще започне да изпраща данни.
        </p>
      )}
      <p className="notice" data-tone="info">
        Днес се свързват ESP32 по Wi-Fi и симулаторът на устройства, и двата по MQTT през шлюза. Zigbee, Bluetooth и
        готовите смарт контакти искат адаптери в шлюза, които още не са направени (issue #18).
      </p>
    </div>
  );
}

/** DeviceConnect with its own message ID and time; „Нов пример“ makes a fresh pair. */
export function DeviceConnectPanel({ device }: { device: OwnedDevice }) {
  const [example, setExample] = useState(() => ({ messageId: uuid4(), observedAt: new Date() }));
  return (
    <DeviceConnect
      device={device}
      messageId={example.messageId}
      observedAt={example.observedAt}
      onNewExample={() => setExample({ messageId: uuid4(), observedAt: new Date() })}
    />
  );
}
