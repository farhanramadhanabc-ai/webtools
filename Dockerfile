FROM mcr.microsoft.com/playwright:v1.48.2-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_ENV=production
ENV BROWSER_PROFILE_DIR=/data/abc-browser-profile
EXPOSE 3000
CMD ["npm","start"]
