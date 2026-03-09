FROM node:lts-alpine

ENV TZ=Asia/Shanghai

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "client.js", "--qr"]