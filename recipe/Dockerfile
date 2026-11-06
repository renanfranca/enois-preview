FROM node:24-bookworm-slim AS design-system
WORKDIR /build/design-system
COPY sources/enois-design-system/ ./
RUN npm ci --ignore-scripts && npm run build && npm run test:dist && npm pack --ignore-scripts --pack-destination /build
RUN mv /build/rede-enois-design-system-*.tgz /build/design-system.tgz && sha256sum /build/design-system.tgz > /build/design-system.sha256

FROM node:24-bookworm-slim AS frontend
WORKDIR /build/enois-frontend
COPY --from=design-system /build/design-system.tgz /build/design-system.tgz
COPY sources/enois-frontend/ ./
RUN npm install --package-lock-only --ignore-scripts && npm ci --ignore-scripts
ENV NITRO_PRESET=node-server VITE_API_BACKEND=/api BACKEND_TARGET=http://127.0.0.1:8081
RUN npm run typecheck && env -u BACKEND_TARGET npm test && npm run build

FROM eclipse-temurin:25-jdk-noble AS backend
WORKDIR /build/backend
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl && rm -rf /var/lib/apt/lists/*
COPY sources/enois-backend/ ./
RUN ./mvnw -B -Dtest=DemoLocalStorageTests,StrictMediaSanitizerTests,MediaStorageProxyTests,MediaMetadataSanitizerTests,BlogFlowTests test && ./mvnw -B -DskipTests package
RUN java -Djarmode=tools -jar target/rede-0.0.1-SNAPSHOT.jar extract --destination /build/extracted --application-filename rede.jar
COPY runtime/DemoCredentials.java /build/tools/DemoCredentials.java
RUN javac -d /build/tools /build/tools/DemoCredentials.java
FROM scratch AS model
ADD --checksum=sha256:864bb37bf8863564b87eb330ab8c785a79a773f4e7c43cb96db52ed8611305fa https://raw.githubusercontent.com/gawryco/opennsfw-onnx/1cbe63c555cb147fb04668e2568517c9bd2379e2/src/opennsfw_onnx/open-nsfw.onnx /model/open-nsfw.onnx

FROM eclipse-temurin:25-jre-noble
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends bash curl git openssh-client procps ca-certificates tar ffmpeg libheif1 && rm -rf /var/lib/apt/lists/* && groupadd --system demo && useradd --system --gid demo --create-home --home-dir /home/demo --shell /bin/bash demo
RUN demo_libheif="$(find /usr/lib -name libheif.so.1 -print -quit)" && test -n "$demo_libheif" && ln -s "$demo_libheif" /usr/lib/libheif.so
WORKDIR /opt/render-demo
COPY --from=backend /build/extracted/ ./backend/
COPY --from=backend /build/tools/DemoCredentials.class ./tools/DemoCredentials.class
COPY --from=model --chmod=0444 /model/open-nsfw.onnx /app/data/open-nsfw.onnx
COPY --from=frontend /build/enois-frontend/.output ./frontend/
COPY --from=frontend /build/enois-frontend/package-lock.json ./provenance/frontend-package-lock.json
COPY --from=design-system /build/design-system.tgz /build/design-system.sha256 ./provenance/
COPY sources/enois-backend/LICENSE ./licenses/enois-backend.LICENSE
COPY sources/enois-frontend/LICENSE ./licenses/enois-frontend.LICENSE
COPY sources/enois-design-system/LICENSE ./licenses/enois-design-system.LICENSE
COPY recipe/licenses/ ./licenses/
COPY data/seed/ ./seed/
COPY data/media/ ./media/
COPY runtime/start.sh runtime/gateway.mjs runtime/image-type.mjs runtime/upload-transport.mjs runtime/register-codespace.mjs runtime/demo-activity.mjs ./
COPY runtime-manifest.json media-mappings.tsv ./
RUN chmod 0555 /app /app/data && chmod -R a+rX /opt/render-demo && chmod 0555 ./start.sh && chown -R root:root /opt/render-demo
ENV SPRING_PROFILES_ACTIVE=demo REDE_SECURITY_ENCRYPTION_KEY_REQUIRED=true OAUTH_STATE_COOKIE_SECURE=true
USER demo
EXPOSE 3000
ENTRYPOINT ["/opt/render-demo/start.sh"]
