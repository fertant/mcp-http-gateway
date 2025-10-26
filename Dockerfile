FROM node:22.18.0-trixie

# Copy package files
COPY ./package.json .
COPY ./package-lock.json .
COPY ./tsconfig.json .
COPY ./babel.config.js .

# Copy source files
COPY ./src ./src
COPY ./test ./test

# Install dependencies
RUN npm ci

# Build the application
RUN npm run build

# Remove source files
RUN rm -rf src

# Expose default port
EXPOSE 3000

CMD ["npm", "run", "start"]