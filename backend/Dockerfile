FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db
RUN mkdir -p storage/uploads
USER node
EXPOSE 3000
CMD ["npm", "start"]
