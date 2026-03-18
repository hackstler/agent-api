import { tool } from "ai";
import { z } from "zod";
import type { YouTubeApiService } from "../services/youtube-api.service.js";

export interface GetVideoDetailsDeps {
  youtubeService: YouTubeApiService;
}

export function createGetVideoDetailsTool({ youtubeService }: GetVideoDetailsDeps) {
  return tool({
    description: "Get detailed information about a specific YouTube video including duration, view count, likes, tags, and more.",
    inputSchema: z.object({
      videoId: z.string().describe("The YouTube video ID (e.g. 'dQw4w9WgXcQ')"),
    }),
    execute: async ({ videoId }) => {
      return youtubeService.getVideoDetails(videoId);
    },
  });
}
