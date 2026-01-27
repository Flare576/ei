import { useState, useEffect, useCallback, useRef } from "react";
import { Processor } from "../../src/core/processor";
import { LocalStorage } from "../../src/storage/local";
import type { PersonaSummary, QueueStatus, Message, Ei_Interface } from "../../src/core/types";

function App() {
  const [processor, setProcessor] = useState<Processor | null>(null);
  const processorRef = useRef<Processor | null>(null);
  const activePersonaRef = useRef<string | null>(null);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    state: "idle",
    pending_count: 0,
  });
  const [activePersona, setActivePersona] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  const logEvent = useCallback((event: string) => {
    console.log(`[EI Event] ${event}`);
    setEvents((prev) => [...prev.slice(-19), `${new Date().toLocaleTimeString()} - ${event}`]);
  }, []);

  useEffect(() => {
    activePersonaRef.current = activePersona;
  }, [activePersona]);

  useEffect(() => {
    const eiInterface: Ei_Interface = {
      onPersonaAdded: () => {
        logEvent("onPersonaAdded");
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onPersonaRemoved: () => {
        logEvent("onPersonaRemoved");
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onPersonaUpdated: (name) => {
        logEvent(`onPersonaUpdated: ${name}`);
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onMessageAdded: (name) => {
        logEvent(`onMessageAdded: ${name}`);
        if (name === activePersonaRef.current) {
          processorRef.current?.getMessages(name).then(setMessages);
        }
      },
      onMessageProcessing: (name) => {
        logEvent(`onMessageProcessing: ${name}`);
        setIsProcessing(true);
      },
      onMessageQueued: (name) => {
        logEvent(`onMessageQueued: ${name}`);
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
      onHumanUpdated: () => {
        logEvent("onHumanUpdated");
      },
      onQueueStateChanged: (state) => {
        logEvent(`onQueueStateChanged: ${state}`);
        setIsProcessing(state === "busy");
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
      onError: (error) => {
        logEvent(`onError: ${error.code} - ${error.message}`);
      },
      onCheckpointStart: () => {
        logEvent("onCheckpointStart");
      },
      onCheckpointCreated: (index) => {
        logEvent(`onCheckpointCreated: ${index !== undefined ? `slot ${index}` : "auto-save"}`);
      },
      onCheckpointDeleted: (index) => {
        logEvent(`onCheckpointDeleted: slot ${index}`);
      },
    };

    const p = new Processor(eiInterface);
    const storage = new LocalStorage();

    p.start(storage).then(() => {
      processorRef.current = p;
      setProcessor(p);
      p.getPersonaList().then((list) => {
        setPersonas(list);
        if (list.length > 0) {
          setActivePersona(list[0].name);
          p.getMessages(list[0].name).then(setMessages);
        }
      });
      p.getQueueStatus().then(setQueueStatus);
    });

    return () => {
      p.stop();
    };
  }, [logEvent]);

  useEffect(() => {
    if (processor && activePersona) {
      processor.getMessages(activePersona).then(setMessages);
    }
  }, [processor, activePersona]);

  const handleSendMessage = async () => {
    if (!processor || !activePersona || !inputValue.trim()) return;
    await processor.sendMessage(activePersona, inputValue.trim());
    setInputValue("");
  };

  const handleCreatePersona = async () => {
    if (!processor) return;
    const name = prompt("Enter persona name:");
    if (!name) return;
    const description = prompt("Enter persona description:");
    if (!description) return;
    await processor.createPersona(name, description);
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>EI V1 - Web Frontend</h1>

      <div style={{ display: "flex", gap: "20px" }}>
        <div style={{ flex: "1" }}>
          <h2>Queue Status</h2>
          <p>
            State: <strong>{queueStatus.state}</strong>
            {isProcessing && " (thinking...)"}
          </p>
          <p>Pending: {queueStatus.pending_count}</p>

          <h2>Personas</h2>
          <button onClick={handleCreatePersona} style={{ marginBottom: "10px" }}>
            + Create Persona
          </button>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {personas.map((p) => (
              <li
                key={p.name}
                onClick={() => setActivePersona(p.name)}
                style={{
                  padding: "8px",
                  cursor: "pointer",
                  backgroundColor: p.name === activePersona ? "#e0e0e0" : "transparent",
                  borderRadius: "4px",
                }}
              >
                <strong>{p.name}</strong>
                {p.short_description && <span style={{ color: "#666" }}> - {p.short_description}</span>}
                {p.is_paused && <span style={{ color: "orange" }}> (paused)</span>}
                {p.is_archived && <span style={{ color: "red" }}> (archived)</span>}
              </li>
            ))}
            {personas.length === 0 && <li style={{ color: "#666" }}>No personas yet</li>}
          </ul>
        </div>

        <div style={{ flex: "2" }}>
          <h2>Chat {activePersona && `with ${activePersona}`}</h2>
          <div
            style={{
              border: "1px solid #ccc",
              borderRadius: "8px",
              height: "400px",
              overflowY: "auto",
              padding: "10px",
              marginBottom: "10px",
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  marginBottom: "10px",
                  textAlign: msg.role === "human" ? "right" : "left",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "8px 12px",
                    borderRadius: "12px",
                    backgroundColor: msg.role === "human" ? "#007bff" : "#e9ecef",
                    color: msg.role === "human" ? "white" : "black",
                    maxWidth: "70%",
                  }}
                >
                  {msg.content}
                </div>
                <div style={{ fontSize: "0.75em", color: "#666", marginTop: "2px" }}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <div style={{ color: "#666", textAlign: "center", marginTop: "50%" }}>
                {activePersona ? "No messages yet. Say hello!" : "Select a persona to start chatting"}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={activePersona ? "Type a message..." : "Select a persona first"}
              disabled={!activePersona || isProcessing}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!activePersona || !inputValue.trim() || isProcessing}
              style={{
                padding: "10px 20px",
                borderRadius: "4px",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                cursor: "pointer",
              }}
            >
              Send
            </button>
          </div>
        </div>

        <div style={{ flex: "1" }}>
          <h2>Event Log</h2>
          <div
            style={{
              border: "1px solid #ccc",
              borderRadius: "8px",
              height: "500px",
              overflowY: "auto",
              padding: "10px",
              fontSize: "0.85em",
              fontFamily: "monospace",
            }}
          >
            {events.map((event, i) => (
              <div key={i} style={{ marginBottom: "4px" }}>
                {event}
              </div>
            ))}
            {events.length === 0 && <div style={{ color: "#666" }}>Events will appear here...</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
