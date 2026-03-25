FROM mcr.microsoft.com/playwright:v1.49.0-jammy

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN npx patchright install chrome

COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
