FROM node:20-alpine

WORKDIR /app

# Native deps for some packages on alpine
RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV INLINE_BACKGROUND_WORKER=false
ENV INLINE_INJECTION_WORKER=false
EXPOSE 3000

# Healthcheck is defined on the api service in docker-compose (workers have no HTTP server).
CMD ["npm", "run", "start:api"]
