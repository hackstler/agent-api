import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { youtubeConfig } from "./config/youtube.config.js";
import { ragConfig } from "../rag/config/rag.config.js";

export function createYouTubeAgent(tools: ToolsInput): Agent {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for YouTubeAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new Agent({
    id: youtubeConfig.agentName,
    name: youtubeConfig.agentName,
    description: "Searches YouTube videos and retrieves video details. Use when the user wants to find videos or get information about a specific YouTube video.",
    instructions: `You are a specialist in finding YouTube videos and retrieving video information.
When asked to search for videos, use searchYouTubeVideos.
When asked about a specific video, use getYouTubeVideoDetails.
Always present results in a clear, organized format with video titles, channels, and links.`,
    model: google(ragConfig.llmModel),
    tools,
  });
}
