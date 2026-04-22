import { initializeApp, getApps, getApp } from "firebase/app";
import { getFunctions } from "firebase/functions";

// 使用使用者嚴格規定的佔位符機制 (Placeholder)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "__FIREBASE_API_KEY__",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "__FIREBASE_AUTH_DOMAIN__",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "__FIREBASE_PROJECT_ID__",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "__FIREBASE_APP_ID__",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const functions = getFunctions(app, "asia-east1");
