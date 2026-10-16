FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY app ./app
COPY schema.sql ./schema.sql
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "app/server.js"]
