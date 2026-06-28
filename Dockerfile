FROM node:22-alpine

WORKDIR /app
RUN npm install -g typescript@6.0.3 esbuild@0.28.0 live-server@1.2.2

CMD ["sh", "-c", "node gen-code.js --watch & tsc --watch & esbuild main.ts --bundle --outfile=dist/bundle.js --watch=forever & live-server --port=8080 --host=0.0.0.0 --no-browser --entry-file=img-edit.html --watch=dist,img-edit.html"]