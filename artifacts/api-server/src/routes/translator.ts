import { Router, type IRouter } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { requireAuth, verifyToken } from "../middleware/auth";
import jwt from "jsonwebtoken";
import {
  PalabraTranslator,
} from "../lib/translator/palabra";

const router: IRouter = Router();

/**
 * Realtime Translator
 *
 * Browser
 *   ↓
 * Nanivio authenticated WebSocket
 *   ↓
 * PalabraTranslator
 *   ↓
 * Palabra AI
 *   ↓
 * translated text + translated speech
 *
 * PALABRA_API_KEY NEVER leaves the server.
 */

interface TranslatorTokenPayload {
  userId: number;
  email: string;
  name: string;
  purpose: "translator";
}

const TRANSLATOR_TOKEN_TTL = "5m";

router.get(
  "/health",
  requireAuth,
  (_req: any, res): void => {
    res.json({
      ok: true,
      service: "realtime-translator",
    });
  },
);

const createTranslatorSession = (req: any, res: any): void => {
  try {
    const payload: TranslatorTokenPayload = {
      userId: req.userId,
      email: req.userEmail,
      name: req.userName,
      purpose: "translator",
    };

    const token = (jwt as any).sign(
      payload,
      process.env.SESSION_SECRET,
      {
        expiresIn: TRANSLATOR_TOKEN_TTL,
      },
    );

    res.json({
      ok: true,
      token,
      expiresIn: 300,
    });
  } catch {
    res.status(500).json({
      error: "Unable to create translator session",
    });
  }
};

router.post(
  "/session",
  requireAuth,
  createTranslatorSession,
);

// Kept for older clients while the frontend/API contract migrates to POST.
router.get(
  "/session",
  requireAuth,
  createTranslatorSession,
);

function sendJson(
  socket: WebSocket,
  payload: Record<string, unknown>,
) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function rawDataToBuffer(
  data: WebSocket.RawData,
): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data));
  }

  return Buffer.concat(data);
}

export function attachTranslatorWebSocket(server: Server) {
  const wss = new WebSocketServer({
    noServer: true,
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(
        req.url ?? "",
        `http://${req.headers.host ?? "localhost"}`,
      );

      if (url.pathname !== "/api/translator/ws") {
        return;
      }

      const token = url.searchParams.get("token")?.trim();

      if (!token) {
        socket.write(
          "HTTP/1.1 401 Unauthorized\r\n" +
          "Connection: close\r\n\r\n",
        );
        socket.destroy();
        return;
      }

      const payload = verifyToken(token);

      if (!payload) {
        socket.write(
          "HTTP/1.1 401 Unauthorized\r\n" +
          "Connection: close\r\n\r\n",
        );
        socket.destroy();
        return;
      }

      let decoded: TranslatorTokenPayload;

      try {
        decoded = (jwt as any).verify(
          token,
          process.env.SESSION_SECRET,
        ) as TranslatorTokenPayload;
      } catch {
        socket.write(
          "HTTP/1.1 401 Unauthorized\r\n" +
          "Connection: close\r\n\r\n",
        );
        socket.destroy();
        return;
      }

      if (
        decoded?.purpose !== "translator" ||
        decoded.userId !== payload.userId
      ) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\n" +
          "Connection: close\r\n\r\n",
        );
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit(
          "connection",
          client,
          req,
          decoded,
        );
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on(
    "connection",
    (
      socket: WebSocket,
      _req: import("http").IncomingMessage,
      user: TranslatorTokenPayload,
    ) => {
      let started = false;
      let enabled = true;

      let translator: PalabraTranslator | null = null;

      let sourceLanguage = "auto";
      let targetLanguage = "en";

      const userId = user.userId;

      sendJson(socket, {
        type: "status",
        status: "connected",
        userId,
        provider: "palabra",
      });

      const destroyTranslator = async () => {
        const current = translator;
        translator = null;
        started = false;

        if (current) {
          try {
            await current.disconnect();
          } catch {
            // Ignore teardown errors.
          }
        }
      };

      const createTranslator = async () => {
        await destroyTranslator();

        const current = new PalabraTranslator(
          {
            sourceLanguage,
            targetLanguage,

            // Palabra voice cloning is enabled.
            // The translated voice is generated to preserve
            // characteristics of the original speaker.
            voiceCloning: true,
          },
          {
            onStatus: (status) => {
              sendJson(socket, {
                type: "status",
                status,
                provider: "palabra",
              });
            },

            onTranscript: (text, language) => {
              sendJson(socket, {
                type: "transcript",
                text,
                language,
              });
            },

            onTranslation: (text, language) => {
              sendJson(socket, {
                type: "translation",
                text,
                language,
              });
            },

            onAudio: (audio, language) => {
              if (
                socket.readyState !== WebSocket.OPEN ||
                !enabled
              ) {
                return;
              }

              sendJson(socket, {
                type: "audio",
                language:
                  language ?? targetLanguage,
                format: "pcm_s16le",
                sampleRate: 24000,
                channels: 1,
                encoding: "base64",
                data: audio.toString("base64"),
              });
            },

            onError: (error) => {
              sendJson(socket, {
                type: "error",
                message: error.message,
              });
            },
          },
        );

        translator = current;

        await current.connect();

        started = true;

        sendJson(socket, {
          type: "translator_ready",
          sourceLanguage,
          targetLanguage,
          voiceCloning: true,
          provider: "palabra",
        });
      };

      socket.on("message", async (data, isBinary) => {
        try {
          /**
           * AUDIO
           *
           * Browser sends microphone PCM audio as binary.
           * We forward it directly to Palabra.
           */
          if (isBinary) {
            if (!started || !translator || !enabled) {
              return;
            }

            const audio = rawDataToBuffer(data);

            const sent = translator.sendAudio(audio);

            if (sent) {
              sendJson(socket, {
                type: "status",
                status: "speaking",
              });
            }

            return;
          }

          /**
           * CONTROL MESSAGE
           */
          const text = data.toString();

          let message: any;

          try {
            message = JSON.parse(text);
          } catch {
            sendJson(socket, {
              type: "error",
              message: "Invalid translator message",
            });
            return;
          }

          switch (message?.type) {
            /**
             * START
             *
             * Example:
             * {
             *   "type": "start",
             *   "sourceLanguage": "en",
             *   "targetLanguage": "fr"
             * }
             */
            case "start": {
              sourceLanguage =
                message.sourceLanguage ??
                message.source_language ??
                "auto";

              targetLanguage =
                message.targetLanguage ??
                message.target_language ??
                "en";

              await createTranslator();
              break;
            }

            /**
             * CHANGE LANGUAGES
             */
            case "languages": {
              if (!started) {
                sendJson(socket, {
                  type: "error",
                  message:
                    "Translator session has not started",
                });
                return;
              }

              sourceLanguage =
                message.sourceLanguage ??
                message.source_language ??
                sourceLanguage;

              targetLanguage =
                message.targetLanguage ??
                message.target_language ??
                targetLanguage;

              await createTranslator();
              break;
            }

            /**
             * ENABLE / DISABLE TRANSLATION
             */
            case "enabled": {
              enabled = message.enabled !== false;

              sendJson(socket, {
                type: "status",
                status: enabled
                  ? "connected"
                  : "idle",
                enabled,
              });

              break;
            }

            /**
             * FLUSH
             *
             * Useful when the browser detects the speaker
             * finished a sentence.
             */
            case "flush": {
              if (!translator || !started) {
                return;
              }

              translator.flush();
              break;
            }

            /**
             * STOP
             */
            case "stop": {
              await destroyTranslator();

              sendJson(socket, {
                type: "status",
                status: "idle",
              });

              break;
            }

            default:
              sendJson(socket, {
                type: "error",
                message:
                  "Unknown translator message type",
              });
          }
        } catch (error) {
          sendJson(socket, {
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Translator processing failed",
          });
        }
      });

      socket.on("close", () => {
        void destroyTranslator();
      });

      socket.on("error", () => {
        void destroyTranslator();
      });
    },
  );

  return wss;
}

export default router;
