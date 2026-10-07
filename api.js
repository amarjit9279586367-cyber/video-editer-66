"use strict";

/*
  ============================================================
  API LAYER ONLY
  ============================================================

  Update this with your actual deployed Render URL.

  Example:
  const BACKEND_URL = "https://my-ai-video-api.onrender.com";
*/
const BACKEND_URL = "YOUR_RENDER_URL_HERE";

const PROCESS_ENDPOINT = "/process";

/*
  Every application action uses this ONE endpoint:

  POST BACKEND_URL + "/process"

  The backend receives an action field, for example:
  {
    "action": "generate_clips",
    "youtube_url": "...",
    "aspect_ratio": "9:16",
    "clip_duration": 30,
    "reel_count": "3"
  }
*/

/**
 * Sends JSON to the single /process endpoint.
 * This function NEVER throws a parsing exception.
 *
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function postProcessJson(payload) {
  if (!BACKEND_URL || BACKEND_URL === "YOUR_RENDER_URL_HERE") {
    return {
      ok: false,
      status: 0,
      error: "BACKEND_URL is not configured in api.js.",
      raw: "BACKEND_URL is still set to YOUR_RENDER_URL_HERE.",
      parsed: null,
      videoUrls: []
    };
  }

  try {
    const response = await fetch(BACKEND_URL + PROCESS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*"
      },
      body: JSON.stringify(payload),
      mode: "cors"
    });

    const raw = await safelyReadResponseText(response);
    const parsed = safelyParseJson(raw);
    const videoUrls = findVideoUrls(parsed, raw);

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: response.ok
        ? null
        : extractBackendError(parsed, raw, response.status),
      raw,
      parsed,
      videoUrls
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: "Network Error",
      error: error?.message || "Network request failed.",
      raw: String(error?.stack || error?.message || error),
      parsed: null,
      videoUrls: []
    };
  }
}

/**
 * Sends multipart form data to the same /process endpoint.
 * Used for local video uploads.
 *
 * @param {File} videoFile
 * @param {object} fields
 * @returns {Promise<object>}
 */
async function postProcessUpload(videoFile, fields = {}) {
  if (!BACKEND_URL || BACKEND_URL === "YOUR_RENDER_URL_HERE") {
    return {
      ok: false,
      status: 0,
      error: "BACKEND_URL is not configured in api.js.",
      raw: "BACKEND_URL is still set to YOUR_RENDER_URL_HERE.",
      parsed: null,
      videoUrls: []
    };
  }

  try {
    const formData = new FormData();

    formData.append("video", videoFile);
    formData.append("action", fields.action || "upload_video");

    Object.entries(fields).forEach(([key, value]) => {
      if (key !== "action" && value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    const response = await fetch(BACKEND_URL + PROCESS_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*"
      },
      body: formData,
      mode: "cors"
    });

    const raw = await safelyReadResponseText(response);
    const parsed = safelyParseJson(raw);
    const videoUrls = findVideoUrls(parsed, raw);

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: response.ok
        ? null
        : extractBackendError(parsed, raw, response.status),
      raw,
      parsed,
      videoUrls
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: "Network Error",
      error: error?.message || "Upload request failed.",
      raw: String(error?.stack || error?.message || error),
      parsed: null,
      videoUrls: []
    };
  }
}

/**
 * Reads response text safely, including backends that return:
 * - JSON
 * - Plain text
 * - HTML error pages
 * - Empty responses
 */
async function safelyReadResponseText(response) {
  try {
    return await response.text();
  } catch (error) {
    return "Unable to read backend response: " + String(error?.message || error);
  }
}

/**
 * Parses JSON without throwing.
 * Returns null for plain text, malformed JSON, or empty responses.
 */
function safelyParseJson(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Looks recursively through unknown backend JSON response shapes.
 *
 * Supported URL keys include:
 * - video_url
 * - videoUrl
 * - url
 * - output_url
 * - outputUrl
 * - processed_url
 * - processedUrl
 * - result_url
 * - resultUrl
 * - download_url
 * - downloadUrl
 * - clip_url
 * - clipUrl
 *
 * This also catches:
 * - response.video_url
 * - response.url
 * - response.data.url
 * - response.clips[0].video_url
 * - deeply nested objects and arrays
 */
function findVideoUrls(parsed, raw) {
  const foundUrls = [];
  const visited = new Set();

  const urlKeyNames = new Set([
    "video_url",
    "videoUrl",
    "url",
    "output_url",
    "outputUrl",
    "processed_url",
    "processedUrl",
    "result_url",
    "resultUrl",
    "download_url",
    "downloadUrl",
    "clip_url",
    "clipUrl",
    "file_url",
    "fileUrl",
    "media_url",
    "mediaUrl"
  ]);

  function addUrl(value) {
    if (typeof value !== "string") {
      return;
    }

    const trimmed = value.trim();

    if (!trimmed || !looksLikeVideoOrMediaUrl(trimmed)) {
      return;
    }

    const absoluteUrl = normalizeUrl(trimmed);

    if (absoluteUrl && !foundUrls.includes(absoluteUrl)) {
      foundUrls.push(absoluteUrl);
    }
  }

  function inspect(value, depth = 0) {
    if (depth > 12 || value === null || value === undefined) {
      return;
    }

    if (typeof value === "string") {
      addUrl(value);
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => inspect(item, depth + 1));
      return;
    }

    Object.entries(value).forEach(([key, nestedValue]) => {
      if (urlKeyNames.has(key)) {
        addUrl(nestedValue);
      }

      inspect(nestedValue, depth + 1);
    });
  }

  inspect(parsed);

  /*
    If backend sends plain text containing an MP4/WEBM/URL,
    search it as a final fallback.
  */
  if (foundUrls.length === 0 && typeof raw === "string") {
    const urlMatches = raw.match(
      /https?://[^s"'<>\\]+|/[A-Za-z0-9_-./]+.(?:mp4|webm|mov|m3u8)(?:?[^s"'<>\\]+)?/gi
    );

    if (urlMatches) {
      urlMatches.forEach(addUrl);
    }
  }

  return foundUrls;
}

/**
 * Avoids incorrectly treating normal backend messages as videos.
 */
function looksLikeVideoOrMediaUrl(value) {
  const lower = value.toLowerCase();

  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("/") ||
    lower.includes(".mp4") ||
    lower.includes(".webm") ||
    lower.includes(".mov") ||
    lower.includes(".m3u8") ||
    lower.includes("video")
  );
}

/**
 * Converts relative paths from Render into full URLs.
 */
function normalizeUrl(value) {
  try {
    return new URL(value, BACKEND_URL).href;
  } catch {
    return null;
  }
}

/**
 * Extracts useful error content from varied backend formats.
 */
function extractBackendError(parsed, raw, status) {
  if (parsed && typeof parsed === "object") {
    const possibleMessage =
      parsed.detail ||
      parsed.message ||
      parsed.error ||
      parsed.errors ||
      parsed.reason;

    if (typeof possibleMessage === "string") {
      return possibleMessage;
    }

    if (possibleMessage) {
      try {
        return JSON.stringify(possibleMessage, null, 2);
      } catch {
        return String(possibleMessage);
      }
    }
  }

  if (typeof raw === "string" && raw.trim()) {
    return raw;
  }

  return "Backend returned HTTP " + status + ".";
}

/**
 * Creates an array of normalized clip objects from varied responses.
 * This does not generate fake URLs or fake clips.
 */
function normalizeClipsFromResponse(apiResult, fallbackDuration = 0) {
  const parsed = apiResult?.parsed;
  const allUrls = apiResult?.videoUrls || [];
  const clipCandidates = [];

  if (Array.isArray(parsed)) {
    clipCandidates.push(...parsed);
  }

  if (Array.isArray(parsed?.clips)) {
    clipCandidates.push(...parsed.clips);
  }

  if (Array.isArray(parsed?.data?.clips)) {
    clipCandidates.push(...parsed.data.clips);
  }

  if (Array.isArray(parsed?.results)) {
    clipCandidates.push(...parsed.results);
  }

  if (Array.isArray(parsed?.data?.results)) {
    clipCandidates.push(...parsed.data.results);
  }

  const normalized = [];
  const usedUrls = new Set();

  clipCandidates.forEach((candidate, index) => {
    const candidateUrls = findVideoUrls(candidate, "");

    const videoUrl = candidateUrls[0];

    if (!videoUrl || usedUrls.has(videoUrl)) {
      return;
    }

    usedUrls.add(videoUrl);

    normalized.push({
      id: String(candidate.id || candidate.clip_id || candidate.uuid || "clip_" + (index + 1)),
      title: candidate.title || candidate.name || "Generated Clip " + (index + 1),
      description:
        candidate.description ||
        candidate.transcript ||
        candidate.caption ||
        "Processed by the backend.",
      viralScore: normalizeScore(
        candidate.viral_score ?? candidate.viralScore ?? candidate.score
      ),
      startTime: Number(candidate.start_time ?? candidate.startTime ?? 0),
      endTime: Number(
        candidate.end_time ??
        candidate.endTime ??
        candidate.duration ??
        fallbackDuration
      ),
      duration: Number(candidate.duration ?? fallbackDuration),
      videoUrl,
      thumbnailUrl: extractThumbnailUrl(candidate)
    });
  });

  allUrls.forEach((videoUrl, index) => {
    if (usedUrls.has(videoUrl)) {
      return;
    }

    usedUrls.add(videoUrl);

    normalized.push({
      id: "returned_video_" + (index + 1),
      title: "Generated Clip " + (index + 1),
      description: "Video URL returned by the backend.",
      viralScore: 0,
      startTime: 0,
      endTime: fallbackDuration,
      duration: fallbackDuration,
      videoUrl,
      thumbnailUrl: null
    });
  });

  return normalized;
}

function extractThumbnailUrl(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const thumbnailKeys = [
    "thumbnail_url",
    "thumbnailUrl",
    "thumbnail",
    "image_url",
    "imageUrl",
    "poster_url",
    "posterUrl"
  ];

  for (const key of thumbnailKeys) {
    if (typeof candidate[key] === "string" && candidate[key].trim()) {
      return normalizeUrl(candidate[key]);
    }
  }

  if (candidate.data && typeof candidate.data === "object") {
    return extractThumbnailUrl(candidate.data);
  }

  return null;
}

function normalizeScore(value) {
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/*
  Expose only API-related functions to ui.js.
*/
window.ClipForgeAPI = {
  BACKEND_URL,
  postProcessJson,
  postProcessUpload,
  normalizeClipsFromResponse,
  normalizeUrl
};