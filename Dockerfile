FROM mcr.microsoft.com/playwright:v1.49.0-jammy

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

ARG YTDLP_VERSION=2026.05.05.233942
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${YTDLP_VERSION}/yt-dlp_linux" -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

RUN npx patchright install chrome

COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
