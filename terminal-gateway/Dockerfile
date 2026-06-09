FROM node:20-alpine

# node-pty 需要原生編譯工具
RUN apk add --no-cache python3 make g++ docker-cli

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

EXPOSE 3001
CMD ["node", "index.js"]
