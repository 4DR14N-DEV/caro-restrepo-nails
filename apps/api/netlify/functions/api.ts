import serverless from "serverless-http";
import { createApp } from "../../src/app.js";

// Adaptador de Netlify Functions: único archivo que conoce la plataforma.
export const handler = serverless(createApp());
