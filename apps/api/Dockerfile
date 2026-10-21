FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx nest build
EXPOSE 4000
CMD ["node", "dist/main.js"]
