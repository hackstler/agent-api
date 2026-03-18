import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import { YouTubeApiService } from "./services/youtube-api.service.js";
import { createSearchVideosTool } from "./tools/search-videos.tool.js";
import { createGetVideoDetailsTool } from "./tools/get-video-details.tool.js";
import { createYouTubeAgent } from "./youtube.agent.js";
import { youtubeConfig } from "./config/youtube.config.js";

export class YouTubePlugin implements Plugin {
  readonly id = "youtube";
  readonly name = "YouTube Plugin";
  readonly description = "Search YouTube videos and get video details.";
  readonly agent;
  readonly tools: AgentTools;

  constructor() {
    const service = new YouTubeApiService(youtubeConfig.apiKey);
    const searchVideos = createSearchVideosTool({ youtubeService: service });
    const getVideoDetails = createGetVideoDetailsTool({ youtubeService: service });
    this.tools = { searchYouTubeVideos: searchVideos, getYouTubeVideoDetails: getVideoDetails };
    this.agent = createYouTubeAgent(this.tools);
  }
}
