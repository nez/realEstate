# Use the official Bun image
FROM oven/bun:1.3

# Set the Docker working directory as /usr/src/app
WORKDIR /usr/src/app

# Copy everything from the current directory into Docker's /usr/src/app
COPY . .

# Set the timezone to JST
ENV TZ=Asia/Tokyo

RUN bun install

# Run the project
CMD bun run index.ts