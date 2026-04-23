FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV INLINE_BACKGROUND_WORKER=false
ENV INLINE_INJECTION_WORKER=false
EXPOSE 3000

CMD ["npm", "run", "start:api"]
