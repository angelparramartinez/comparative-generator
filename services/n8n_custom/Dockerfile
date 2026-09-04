# Imagen n8n con modulos npm externos disponibles en el Code node
# (NODE_FUNCTION_ALLOW_EXTERNAL solo autoriza el require -- el Task Runner
# real de n8n (proceso aparte que ejecuta el JS del Code node, ver
# @n8n/task-runner/dist/js-task-runner/require-resolver.js) resuelve esos
# modulos desde el node_modules de la propia instalacion de n8n
# (/usr/local/lib/node_modules/n8n/node_modules), que la imagen oficial no
# trae.
#
# --install-strategy=nested (bug real 29/07): un primer intento con
# instalacion normal (hoisted) + copia sin sobrescribir dejaba que exceljs
# usara el "readable-stream" que YA traia n8n de fabrica (una version mas
# antigua, compartida con otras dependencias internas de n8n) en vez de la
# suya propia -- exceljs.xlsx.load() fallaba con "iterable is not async
# iterable" al parsear cualquier entrada del .xlsx que use su parser SAX
# (xl/drawings/drawingN.xml en el caso real que lo disparo, un Excel con un
# dibujo/imagen embebido). --install-strategy=nested evita el hoisting: cada
# dependencia de exceljs queda anidada dentro de exceljs/node_modules, nunca
# comparte ni pisa nada del node_modules real de n8n (confirmado en vivo
# contra el .xlsx real de Generali antes de fijarlo aqui). jszip no hace
# falta instalarlo aparte -- n8n ya lo trae de serie (usado por su nodo
# "Compression"), NODE_FUNCTION_ALLOW_EXTERNAL solo necesita autorizarlo.
# Version pineada a proposito (04/09/2026): con ":latest" la version real de
# n8n la fijaba la fecha en que se construyo la imagen, no una decision -- un
# "build --pull" por cualquier otro motivo saltaba varios minors de golpe y sin
# avisar. Se subio de 2.20.6 (que era lo que habia quedado cacheado del
# 08/05/2026) a 2.37.9, la ultima estable. Para actualizar: cambiar este tag.
FROM n8nio/n8n:2.37.9

USER root
RUN mkdir -p /tmp/extra_modules \
  && cd /tmp/extra_modules \
  && npm init -y >/dev/null \
  && npm install --install-strategy=nested exceljs \
  && cp -r node_modules/exceljs /usr/local/lib/node_modules/n8n/node_modules/exceljs \
  && rm -rf /tmp/extra_modules
USER node
