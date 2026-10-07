FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/data/checkout.db TRUST_PROXY=1
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
