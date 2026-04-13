FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN mkdir -p uploads/images uploads/audio uploads/video data
EXPOSE 3000
CMD ["node", "server.js"]
