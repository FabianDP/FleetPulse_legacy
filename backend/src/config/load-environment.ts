import { loadEnvironment } from "./environment";

// Loaded before app/database imports, in both src/ (tsx) and dist/ (node).
loadEnvironment();
