import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./ui/App.jsx";
import { createFirestoreStore } from "./store/firestoreStore.js";
import { createDemoStore } from "./demo.js";
import { firebaseConfigured } from "./firebase.js";

const demo = new URLSearchParams(window.location.search).has("demo") || !firebaseConfigured && window.location.hostname === "localhost";
const createStore = demo ? () => createDemoStore() : (user) => createFirestoreStore(() => user?.email || "bilinmiyor");

createRoot(document.getElementById("root")).render(<App createStore={createStore} demo={demo} />);
