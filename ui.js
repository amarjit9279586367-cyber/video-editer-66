"use strict";

/*
  ============================================================
  UI LAYER ONLY
  ============================================================

  This file:
  - Handles DOM events
  - Manages loading overlays
  - Renders backend results
  - Shows exact raw backend responses for debugging

  This file does NOT directly use fetch().
  All network requests are delegated to api.js.
*/

const state = {
  source: {
    type: null,
    youtubeUrl: null,
    file: null,
    objectUrl: null,
    thumbnail: null,
    title: null,
    duration: 0
  },
  config: {
    aspectRatio: "9:16",
    duration: 30,
    reelCount: "3"
  },
  clips: [],
  activeClip: null,
  isBusy: false,
  exportUrls: {
    video: null,
    thumbnail: null,
    download: null
  }
};

document.addEventListener("DOMContentLoaded", initializeUI);

function initializeUI() {
  bindSourceControls();
  bindConfigurationControls();
  bindEditorControls();
  bindExportControls();
  markBackendConfigured();
}

/*
  ============================================================
  SOURCE INPUT UI
  ============================================================
*/

function bindSourceControls() {
  const youtubeInput = document.getElementById("youtubeUrl");
  const confirmYoutubeButton = document.getElementById("confirmYoutubeButton");
  const uploadInput = document.getElementById("localVideoInput");
  const uploadTrigger = document.getElementById("uploadTrigger");
  const uploadCard = document.getElementById("uploadCard");

  confirmYoutubeButton.addEventListener("click", () => {
    selectYoutubeSource(youtubeInput.value.trim());
  });

  youtubeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      selectYoutubeSource(youtubeInput.value.trim());
    }
  });

  uploadTrigger.addEventListener("click", () => {
    uploadInput.click();
  });

  uploadInput.addEventListener("change", (event) => {
    const file = event.target.files[0];

    if (file) {
      selectLocalVideo(file);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    uploadCard.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadCard.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    uploadCard.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadCard.classList.remove("dragging");
    });
  });

  uploadCard.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];

    if (!file || !file.type.startsWith("video/")) {
      showToast(
        "Invalid file",
        "Please upload a valid MP4, MOV, or WebM video.",
        "error"
      );
      return;
    }

    selectLocalVideo(file);
  });

  document.getElementById("removeSourceButton").addEventListener("click", resetSource);
  document.getElementById("closeDebugButton").addEventListener("click", hideDebugPanel);
}

function selectYoutubeSource(url) {
  if (!isValidUrl(url)) {
    showToast(
      "Invalid YouTube URL",
      "Enter a complete URL beginning with https://.",
      "error"
    );
    return;
  }

  const youtubeId = extractYoutubeId(url);

  state.source = {
    type: "youtube",
    youtubeUrl: url,
    file: null,
    objectUrl: null,
    thumbnail: youtubeId
      ? "https://i.ytimg.com/vi/" + youtubeId + "/hqdefault.jpg"
      : createFallbackThumbnail(),
    title: "YouTube video selected",
    duration: 0
  };

  renderSourceConfirmation(
    state.source.thumbnail,
    state.source.title,
    "This YouTube URL will be submitted to your Render backend.",
    "--:--"
  );

  hideDebugPanel();
}

function selectLocalVideo(file) {
  if (state.source.objectUrl) {
    URL.revokeObjectURL(state.source.objectUrl);
  }

  const objectUrl = URL.createObjectURL(file);
  const temporaryVideo = document.createElement("video");

  temporaryVideo.preload = "metadata";
  temporaryVideo.src = objectUrl;

  temporaryVideo.addEventListener("loadedmetadata", () => {
    state.source = {
      type: "upload",
      youtubeUrl: null,
      file,
      objectUrl,
      thumbnail: null,
      title: file.name,
      duration: Number.isFinite(temporaryVideo.duration)
        ? temporaryVideo.duration
        : 0
    };

    temporaryVideo.currentTime = Math.min(1, temporaryVideo.duration / 2);

    temporaryVideo.addEventListener(
      "seeked",
      () => {
        state.source.thumbnail = createThumbnailFromVideo(temporaryVideo);

        renderSourceConfirmation(
          state.source.thumbnail,
          file.name,
          formatFileSize(file.size) + " · Local video selected for backend upload.",
          formatTime(state.source.duration)
        );

        hideDebugPanel();
      },
      { once: true }
    );
  });

  temporaryVideo.addEventListener("error", () => {
    showToast(
      "Could not read video",
      "The browser could not load metadata from this selected file.",
      "error"
    );
  });
}

function renderSourceConfirmation(thumbnail, title, metadata, duration) {
  document.getElementById("sourceThumbnail").src = thumbnail || createFallbackThumbnail();
  document.getElementById("sourceTitle").textContent = title;
  document.getElementById("sourceMetadata").textContent = metadata;
  document.getElementById("sourceDurationBadge").textContent = duration;
  document.getElementById("sourceConfirmation").classList.remove("hidden");
}

function resetSource() {
  if (state.source.objectUrl) {
    URL.revokeObjectURL(state.source.objectUrl);
  }

  state.source = {
    type: null,
    youtubeUrl: null,
    file: null,
    objectUrl: null,
    thumbnail: null,
    title: null,
    duration: 0
  };

  document.getElementById("youtubeUrl").value = "";
  document.getElementById("localVideoInput").value = "";
  document.getElementById("sourceConfirmation").classList.add("hidden");
}

/*
  ============================================================
  CONFIGURATION UI
  ============================================================
*/

function bindConfigurationControls() {
  document.querySelectorAll(".ratio-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".ratio-button").forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
      state.config.aspectRatio = button.dataset.ratio;
    });
  });

  document.getElementById("durationSelect").addEventListener("change", (event) => {
    const customPanel = document.getElementById("customDurationPanel");

    if (event.target.value === "custom") {
      customPanel.classList.remove("hidden");
      updateCustomDuration();
    } else {
      customPanel.classList.add("hidden");
      state.config.duration = Number(event.target.value);
    }
  });

  document.getElementById("customMinutes").addEventListener("input", updateCustomDuration);
  document.getElementById("customSeconds").addEventListener("input", updateCustomDuration);

  document.getElementById("reelCount").addEventListener("change", (event) => {
    state.config.reelCount = event.target.value;
  });

  document.getElementById("generateButton").addEventListener("click", submitGenerationRequest);

  document.getElementById("newProjectButton").addEventListener("click", () => {
    document.getElementById("gallerySection").classList.add("hidden");
    document.getElementById("editorSection").classList.add("hidden");
    document.getElementById("entrySection").classList.remove("hidden");
    document.getElementById("entrySection").scrollIntoView({ behavior: "smooth" });
  });
}

function updateCustomDuration() {
  const minuteInput = document.getElementById("customMinutes");
  const secondInput = document.getElementById("customSeconds");

  const minutes = clamp(Number(minuteInput.value) || 0, 0, 59);
  const seconds = clamp(Number(secondInput.value) || 0, 0, 59);

  minuteInput.value = String(minutes);
  secondInput.value = String(seconds);

  state.config.duration = minutes * 60 + seconds;
}

function getValidatedDuration() {
  const durationMode = document.getElementById("durationSelect").value;

  if (durationMode !== "custom") {
    return Number(durationMode);
  }

  updateCustomDuration();

  if (state.config.duration <= 0) {
    showToast(
      "Invalid custom duration",
      "Enter a duration of at least one second.",
      "error"
    );
    return null;
  }

  return state.config.duration;
}

/*
  ============================================================
  REAL GENERATION REQUEST
  ============================================================
*/

async function submitGenerationRequest() {
  if (state.isBusy) {
    return;
  }

  if (!state.source.type) {
    showToast(
      "Video source required",
      "Paste a YouTube URL or upload a local video before generating clips.",
      "error"
    );
    return;
  }

  const duration = getValidatedDuration();

  if (!duration) {
    return;
  }

  state.config.duration = duration;

  const generateButton = document.getElementById("generateButton");

  state.isBusy = true;
  setButtonBusy(generateButton, "Processing Request…");

  showProcessingOverlay(
    "Generating Clips",
    "The request is running on your Render backend. This overlay remains visible until the backend sends a real response."
  );

  hideDebugPanel();

  let apiResult;

  if (state.source.type === "youtube") {
    apiResult = await window.ClipForgeAPI.postProcessJson({
      action: "generate_clips",
      youtube_url: state.source.youtubeUrl,
      aspect_ratio: state.config.aspectRatio,
      clip_duration: state.config.duration,
      reel_count: state.config.reelCount
    });
  } else {
    apiResult = await window.ClipForgeAPI.postProcessUpload(
      state.source.file,
      {
        action: "upload_video",
        aspect_ratio: state.config.aspectRatio,
        clip_duration: state.config.duration,
        reel_count: state.config.reelCount
      }
    );
  }

  hideProcessingOverlay();
  resetGenerateButton(generateButton);
  state.isBusy = false;

  const clips = window.ClipForgeAPI.normalizeClipsFromResponse(
    apiResult,
    state.config.duration
  );

  if (!apiResult.ok) {
    showExactBackendResponse(
      "Backend Request Failed",
      apiResult.error || "The backend returned an unsuccessful response.",
      apiResult
    );

    showToast(
      "Backend request failed",
      "The exact backend response is displayed below for debugging.",
      "error"
    );

    return;
  }

  if (clips.length === 0) {
    showExactBackendResponse(
      "No Playable Video URL Found",
      "The backend responded successfully, but no video URL was detected in its response.",
      apiResult
    );

    showToast(
      "No video URL found",
      "Review the exact backend response shown on screen.",
      "error"
    );

    return;
  }

  state.clips = clips;
  renderClipGallery();

  document.getElementById("entrySection").classList.add("hidden");
  document.getElementById("gallerySection").classList.remove("hidden");
  document.getElementById("gallerySection").scrollIntoView({ behavior: "smooth" });

  showToast(
    "Generation complete",
    clips.length + " playable backend video result(s) were found.",
    "success"
  );
}

/*
  ============================================================
  GALLERY UI
  ============================================================
*/

function renderClipGallery() {
  const gallery = document.getElementById("clipGallery");

  const averageScore = state.clips.length
    ? Math.round(
        state.clips.reduce((sum, clip) => sum + clip.viralScore, 0) /
        state.clips.length
      )
    : 0;

  document.getElementById("clipCountLabel").textContent = String(state.clips.length);
  document.getElementById("averageScoreLabel").textContent = averageScore + "%";

  gallery.innerHTML = state.clips
    .map((clip) => {
      const poster = clip.thumbnailUrl
        ? 'poster="' + escapeHtml(clip.thumbnailUrl) + '"'
        : "";

      const scoreText = clip.viralScore > 0
        ? "🔥 " + clip.viralScore + "% Viral Chance"
        : "🔥 Viral Score unavailable";

      return `
        <article class="clip-card">
          <div class="clip-preview">
            <video
              id="gallery-video-${escapeHtml(clip.id)}"
              src="${escapeHtml(clip.videoUrl)}"
              ${poster}
              preload="metadata"
              playsinline
            ></video>

            <span class="viral-score">${escapeHtml(scoreText)}</span>

            <button
              class="preview-play"
              data-preview-id="${escapeHtml(clip.id)}"
              type="button"
              aria-label="Play video preview"
            >
              ▶
            </button>

            <span class="clip-duration">${formatTime(clip.duration)}</span>
          </div>

          <div class="clip-details">
            <h3>${escapeHtml(clip.title)}</h3>
            <p>${escapeHtml(clip.description)}</p>

            <div class="clip-footer">
              <span>${formatTime(clip.startTime)} — ${formatTime(clip.endTime)}</span>

              <button
                class="edit-button"
                data-edit-id="${escapeHtml(clip.id)}"
                type="button"
              >
                Edit in Pro →
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-preview-id]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleGalleryVideo(button.dataset.previewId, button);
    });
  });

  document.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openEditor(button.dataset.editId);
    });
  });
}

async function toggleGalleryVideo(clipId, triggerButton) {
  const video = document.getElementById("gallery-video-" + clipId);

  if (!video) {
    return;
  }

  try {
    if (video.paused) {
      document.querySelectorAll(".clip-preview video").forEach((item) => {
        if (item !== video) {
          item.pause();
        }
      });

      document.querySelectorAll("[data-preview-id]").forEach((button) => {
        if (button !== triggerButton) {
          button.textContent = "▶";
        }
      });

      await video.play();
      triggerButton.textContent = "❚❚";
    } else {
      video.pause();
      triggerButton.textContent = "▶";
    }
  } catch (error) {
    showToast(
      "Playback failed",
      "The returned backend video URL could not be played by this browser.",
      "error"
    );
  }

  video.addEventListener(
    "ended",
    () => {
      triggerButton.textContent = "▶";
    },
    { once: true }
  );
}

/*
  ============================================================
  EDITOR UI
  ============================================================
*/

function bindEditorControls() {
  const editorVideo = document.getElementById("editorVideo");

  document.getElementById("backToGalleryButton").addEventListener("click", () => {
    editorVideo.pause();
    document.getElementById("editorSection").classList.add("hidden");
    document.getElementById("gallerySection").classList.remove("hidden");
    document.getElementById("gallerySection").scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("exportScrollButton").addEventListener("click", () => {
    document.getElementById("exportPanel").scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });

  document.getElementById("playButton").addEventListener("click", toggleEditorVideo);

  editorVideo.addEventListener("play", () => {
    document.getElementById("playButton").textContent = "❚❚";
  });

  editorVideo.addEventListener("pause", () => {
    document.getElementById("playButton").textContent = "▶";
  });

  editorVideo.addEventListener("timeupdate", updateEditorTimeline);

  editorVideo.addEventListener("loadedmetadata", () => {
    const duration = getCurrentEditorDuration();

    document.getElementById("totalTime").textContent = formatTime(duration);
    document.getElementById("timelineDuration").textContent = formatTime(duration);
  });

  editorVideo.addEventListener("error", () => {
    showToast(
      "Editor playback error",
      "The active backend video URL could not be loaded.",
      "error"
    );
  });

  document.getElementById("playbackRange").addEventListener("input", (event) => {
    const duration = getCurrentEditorDuration();

    if (!duration) {
      return;
    }

    const progress = Number(event.target.value);
    editorVideo.currentTime = duration * (progress / 100);

    updatePlayhead(progress);
    document.getElementById("currentTime").textContent = formatTime(editorVideo.currentTime);
  });

  document.getElementById("editorRatio").addEventListener("change", (event) => {
    updateEditorRatio(event.target.value);
  });

  document.getElementById("scaleRange").addEventListener("input", (event) => {
    const value = Number(event.target.value);

    document.getElementById("scaleLabel").textContent = value + "%";
    document
      .getElementById("videoCanvas")
      .style.setProperty("--clip-scale", value / 100);
  });

  document.getElementById("positionRange").addEventListener("input", (event) => {
    const value = Number(event.target.value);

    document.getElementById("positionLabel").textContent = value + "%";
    document
      .getElementById("videoCanvas")
      .style.setProperty("--clip-position", (50 - value) / 5 + "%");
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      requestEditorTool(button.dataset.action, button);
    });
  });

  document.getElementById("captionToggle").addEventListener("change", (event) => {
    requestCaptionUpdate(event.target.checked);
  });
}

function openEditor(clipId) {
  const clip = state.clips.find((item) => item.id === clipId);

  if (!clip || !clip.videoUrl) {
    showToast(
      "No playable video",
      "This clip does not contain a backend video URL.",
      "error"
    );
    return;
  }

  state.activeClip = clip;

  const editorVideo = document.getElementById("editorVideo");

  editorVideo.pause();
  editorVideo.src = clip.videoUrl;
  editorVideo.load();

  document.getElementById("editorClipTitle").textContent = clip.title;
  document.getElementById("activeClipId").textContent = clip.id;
  document.getElementById("timelineVideoClip").textContent = clip.title;
  document.getElementById("timelineDuration").textContent = formatTime(clip.duration);
  document.getElementById("totalTime").textContent = formatTime(clip.duration);
  document.getElementById("currentTime").textContent = "00:00";
  document.getElementById("playbackRange").value = "0";

  updateEditorRatio(state.config.aspectRatio);
  updatePlayhead(0);

  document.getElementById("entrySection").classList.add("hidden");
  document.getElementById("gallerySection").classList.add("hidden");
  document.getElementById("editorSection").classList.remove("hidden");

  document.getElementById("editorSection").scrollIntoView({ behavior: "smooth" });
}

async function toggleEditorVideo() {
  const editorVideo = document.getElementById("editorVideo");

  if (!editorVideo.src) {
    showToast(
      "No active video",
      "Open a generated clip from the gallery first.",
      "error"
    );
    return;
  }

  try {
    if (editorVideo.paused) {
      await editorVideo.play();
    } else {
      editorVideo.pause();
    }
  } catch (error) {
    showToast(
      "Playback failed",
      "The browser could not play the returned backend video.",
      "error"
    );
  }
}

function updateEditorTimeline() {
  const editorVideo = document.getElementById("editorVideo");
  const duration = getCurrentEditorDuration();

  if (!duration) {
    return;
  }

  const progress = (editorVideo.currentTime / duration) * 100;

  document.getElementById("currentTime").textContent = formatTime(editorVideo.currentTime);
  document.getElementById("playbackRange").value = String(progress);
  updatePlayhead(progress);
}

function getCurrentEditorDuration() {
  const editorVideo = document.getElementById("editorVideo");

  if (Number.isFinite(editorVideo.duration) && editorVideo.duration > 0) {
    return editorVideo.duration;
  }

  return state.activeClip?.duration || 0;
}

function updatePlayhead(progress) {
  document.getElementById("timelinePlayhead").style.left = progress + "%";
}

function updateEditorRatio(ratio) {
  const canvas = document.getElementById("videoCanvas");

  canvas.classList.remove("ratio-9-16", "ratio-1-1", "ratio-16-9");
  canvas.classList.add("ratio-" + ratio.replace(":", "-"));

  document.getElementById("editorRatio").value = ratio;
  document.getElementById("editorRatioLabel").textContent = ratio;

  state.config.aspectRatio = ratio;
}

/*
  ============================================================
  REAL EDITOR TOOL REQUESTS
  ============================================================
*/

async function requestEditorTool(action, button) {
  if (state.isBusy) {
    return;
  }

  if (!state.activeClip?.id) {
    showToast(
      "Select a clip first",
      "Open a generated clip in Pro Editor before using tools.",
      "error"
    );
    return;
  }

  const payload = buildToolPayload(action);

  if (!payload) {
    return;
  }

  state.isBusy = true;
  button.disabled = true;

  showProcessingOverlay(
    payload.loadingTitle,
    payload.loadingDescription
  );

  const result = await window.ClipForgeAPI.postProcessJson(payload.request);

  hideProcessingOverlay();
  button.disabled = false;
  state.isBusy = false;

  await processToolResponse(result, payload.loadingTitle);
}

function buildToolPayload(action) {
  const basePayload = {
    clip_id: state.activeClip.id,
    source_video_url: state.activeClip.videoUrl,
    aspect_ratio: state.config.aspectRatio
  };

  if (action === "dubbing") {
    return {
      loadingTitle: "Dubbing Voice",
      loadingDescription:
        "Waiting for your backend to translate, synthesize, and render the dubbed video.",
      request: {
        ...basePayload,
        action: "dubbing",
        from_language: document.getElementById("dubFrom").value,
        to_language: document.getElementById("dubTo").value
      }
    };
  }

  if (action === "voice_change") {
    return {
      loadingTitle: "Changing Voice",
      loadingDescription:
        "Waiting for your backend to generate and render the selected voice style.",
      request: {
        ...basePayload,
        action: "voice_change",
        voice_style: document.getElementById("voiceStyle").value
      }
    };
  }

  if (action === "broll") {
    return {
      loadingTitle: "Generating AI B-Roll",
      loadingDescription:
        "Waiting for your backend to create and render AI B-roll additions.",
      request: {
        ...basePayload,
        action: "broll",
        include_meme_sound_effects: true
      }
    };
  }

  if (action === "studio_sound") {
    return {
      loadingTitle: "Enhancing Studio Sound",
      loadingDescription:
        "Waiting for your backend to remove noise and render enhanced audio.",
      request: {
        ...basePayload,
        action: "studio_sound",
        noise_reduction: true,
        voice_enhancement: true
      }
    };
  }

  if (action === "thumbnail") {
    return {
      loadingTitle: "Generating Viral Thumbnail",
      loadingDescription:
        "Waiting for your backend to generate thumbnail artwork.",
      request: {
        ...basePayload,
        action: "thumbnail"
      }
    };
  }

  return null;
}

async function requestCaptionUpdate(enabled) {
  if (state.isBusy) {
    document.getElementById("captionToggle").checked = !enabled;
    return;
  }

  if (!state.activeClip?.id) {
    document.getElementById("captionToggle").checked = false;

    showToast(
      "Select a clip first",
      "Open a generated clip before requesting captions.",
      "error"
    );

    return;
  }

  state.isBusy = true;
  document.getElementById("captionToggle").disabled = true;

  showProcessingOverlay(
    enabled ? "Generating Hormozi Captions" : "Removing Captions",
    enabled
      ? "Waiting for the backend to transcribe and render word-level captions."
      : "Waiting for the backend to render a caption-free output."
  );

  const result = await window.ClipForgeAPI.postProcessJson({
    action: "captions",
    clip_id: state.activeClip.id,
    source_video_url: state.activeClip.videoUrl,
    enabled,
    preset: "Hormozi 3D",
    aspect_ratio: state.config.aspectRatio
  });

  hideProcessingOverlay();
  document.getElementById("captionToggle").disabled = false;
  state.isBusy = false;

  if (!result.ok || result.videoUrls.length === 0) {
    document.getElementById("captionToggle").checked = !enabled;

    showExactBackendResponse(
      "Caption Request Did Not Return a Video URL",
      result.error ||
        "The backend did not return an updated playable video URL for the caption operation.",
      result
    );

    return;
  }

  applyReturnedVideoUrl(result.videoUrls[0]);

  document.getElementById("captionOverlay").classList.toggle("hidden", !enabled);
  document.getElementById("timelineCaptionClip").classList.toggle("hidden", !enabled);

  showToast(
    "Caption request complete",
    "The backend returned an updated video URL.",
    "success"
  );
}

async function processToolResponse(result, toolTitle) {
  if (!result.ok) {
    showExactBackendResponse(
      toolTitle + " Failed",
      result.error || "The backend returned an error.",
      result
    );

    return;
  }

  if (result.videoUrls.length === 0) {
    showExactBackendResponse(
      toolTitle + " Returned No Video URL",
      "The backend completed the request but did not return an updated playable video URL.",
      result
    );

    return;
  }

  applyReturnedVideoUrl(result.videoUrls[0]);

  showToast(
    toolTitle + " Complete",
    "The editor has been updated using the video URL returned by the backend.",
    "success"
  );
}

function applyReturnedVideoUrl(videoUrl) {
  if (!state.activeClip) {
    return;
  }

  state.activeClip.videoUrl = videoUrl;

  const clipIndex = state.clips.findIndex((clip) => {
    return clip.id === state.activeClip.id;
  });

  if (clipIndex >= 0) {
    state.clips[clipIndex].videoUrl = videoUrl;
  }

  const editorVideo = document.getElementById("editorVideo");
  const previousTime = editorVideo.currentTime || 0;

  editorVideo.pause();
  editorVideo.src = videoUrl;
  editorVideo.load();

  editorVideo.addEventListener(
    "loadedmetadata",
    () => {
      if (Number.isFinite(editorVideo.duration)) {
        editorVideo.currentTime = Math.min(previousTime, editorVideo.duration);
      }
    },
    { once: true }
  );
}

/*
  ============================================================
  REAL EXPORT REQUEST
  ============================================================
*/

function bindExportControls() {
  document.getElementById("exportButton").addEventListener("click", requestExport);
}

async function requestExport() {
  if (state.isBusy) {
    return;
  }

  if (!state.activeClip?.id) {
    showToast(
      "No clip selected",
      "Open a generated clip in Pro Editor before exporting.",
      "error"
    );

    return;
  }

  const exportButton = document.getElementById("exportButton");
  const quality = document.getElementById("qualitySelect").value;

  state.isBusy = true;
  exportButton.disabled = true;

  showProcessingOverlay(
    "Preparing Final Export",
    "Waiting for the Render backend to render the final reel and thumbnail."
  );

  const result = await window.ClipForgeAPI.postProcessJson({
    action: "export",
    clip_id: state.activeClip.id,
    source_video_url: state.activeClip.videoUrl,
    quality,
    aspect_ratio: state.config.aspectRatio,
    include_thumbnail: true,
    captions_enabled: document.getElementById("captionToggle").checked
  });

  hideProcessingOverlay();
  exportButton.disabled = false;
  state.isBusy = false;

  if (!result.ok) {
    showExactBackendResponse(
      "Export Request Failed",
      result.error || "The backend returned an export error.",
      result
    );

    return;
  }

  if (result.videoUrls.length === 0) {
    showExactBackendResponse(
      "Export Response Has No Downloadable URL",
      "No playable media URL was detected in the export response.",
      result
    );

    return;
  }

  const downloadUrl = result.videoUrls[0];

  showToast(
    "Export ready",
    "Opening the real URL returned by your backend.",
    "success"
  );

  window.open(downloadUrl, "_blank", "noopener");
}

/*
  ============================================================
  LOADING AND DEBUG UI
  ============================================================
*/

function showProcessingOverlay(title, description) {
  document.getElementById("processingTitle").textContent = title;
  document.getElementById("processingDescription").textContent = description;
  document.getElementById("processingOverlay").classList.remove("hidden");
}

function hideProcessingOverlay() {
  document.getElementById("processingOverlay").classList.add("hidden");
}

function setButtonBusy(button, label) {
  button.disabled = true;
  button.innerHTML = `<span>${escapeHtml(label)}</span>`;
}

function resetGenerateButton(button) {
  button.disabled = false;
  button.innerHTML = `
    <span>✦</span>
    <span>Generate Clips</span>
    <span>→</span>
  `;
}

function showExactBackendResponse(title, message, apiResult) {
  const rawOutput = formatRawBackendResponse(apiResult);

  document.getElementById("debugTitle").textContent = title;
  document.getElementById("debugMessage").textContent = message;
  document.getElementById("rawResponseOutput").textContent = rawOutput;
  document.getElementById("debugPanel").classList.remove("hidden");

  document.getElementById("debugPanel").scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function hideDebugPanel() {
  document.getElementById("debugPanel").classList.add("hidden");
}

function formatRawBackendResponse(apiResult) {
  const metadata = {
    http_status: apiResult?.status ?? 0,
    status_text: apiResult?.statusText ?? "",
    parsed_json_detected: Boolean(apiResult?.parsed),
    detected_video_urls: apiResult?.videoUrls || []
  };

  const parsedBlock = apiResult?.parsed
    ? safelyStringify(apiResult.parsed)
    : "(Response was not valid JSON.)";

  const rawBlock =
    apiResult?.raw && String(apiResult.raw).trim()
      ? String(apiResult.raw)
      : "(Backend returned an empty response body.)";

  return [
    "=== REQUEST METADATA ===",
    safelyStringify(metadata),
    "",
    "=== PARSED JSON ===",
    parsedBlock,
    "",
    "=== EXACT RAW RESPONSE BODY ===",
    rawBlock
  ].join("
");
}

/*
  ============================================================
  UTILITIES
  ============================================================
*/

function markBackendConfigured() {
  const statusDot = document.querySelector(".status-dot");
  const backendLabel = document.querySelector("#backendStatus span:last-child");

  if (
    window.ClipForgeAPI.BACKEND_URL &&
    window.ClipForgeAPI.BACKEND_URL !== "YOUR_RENDER_URL_HERE"
  ) {
    statusDot.classList.add("connected");
    backendLabel.textContent = "Render endpoint configured";
  } else {
    backendLabel.textContent = "Render URL not configured";
  }
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractYoutubeId(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace("www.", "");

    if (hostname === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0] || null;
    }

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }

      const pathParts = parsed.pathname.split("/").filter(Boolean);

      if (["shorts", "embed", "live"].includes(pathParts[0])) {
        return pathParts[1] || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function createThumbnailFromVideo(video) {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.84);
  } catch {
    return createFallbackThumbnail();
  }
}

function createFallbackThumbnail() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">' +
    '<rect width="100%" height="100%" fill="#1a222d"/>' +
    '<circle cx="320" cy="180" r="55" fill="#b9fa42" opacity="0.18"/>' +
    '<path d="M300 145 L300 215 L360 180 Z" fill="#b9fa42"/>' +
    "</svg>";

  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(remainingSeconds).padStart(2, "0")
  );
}

function formatFileSize(bytes) {
  if (!bytes) {
    return "0 MB";
  }

  const megabytes = bytes / (1024 * 1024);

  return megabytes >= 1024
    ? (megabytes / 1024).toFixed(2) + " GB"
    : megabytes.toFixed(1) + " MB";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safelyStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(title, message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("article");

  toast.className = "toast " + type;
  toast.innerHTML = `
    <span class="toast-icon">${type === "error" ? "!" : "✓"}</span>
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;

  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 6500);
}