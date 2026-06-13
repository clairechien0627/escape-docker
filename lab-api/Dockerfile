FROM node:20-alpine

# bash/python3：lab/exploits/*.sh 與 lib/common.sh 需要
# docker-cli：exploit 腳本透過 docker exec 操作各房間（搭配掛載的 docker.sock）
RUN apk add --no-cache bash docker-cli python3

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4100
CMD ["node", "index.js"]
