[README.md](https://github.com/user-attachments/files/30633428/README.md)
# dev/ - инструменты разработки

В прод не попадает. Это папка для итерации по виду колеса.

    npm install          # только для превью-рендера в PNG

## wheel-lab.html
Автономная страница: ползунки числа кошельков и разброса билетов,
переключение темы, качества и подписи сектора, кнопки Idle / PreDraw /
Розыгрыш. Нужен локальный сервер - ES-модули не работают с file://

    python3 -m http.server 8080
    # http://localhost:8080/dev/wheel-lab.html

## oracle-draw-preview.html
Предпоказ страницы целиком. Самодостаточный: все модули вшиты внутрь,
открывается двойным кликом. Пересобирается после правок в модулях:

    node _build_preview.js

## Сборка бандла

После любой правки в assets/js/wheel/ или assets/js/draw-v2/:

    node dev/_build_bundle.js

Он печатает номер версии - подставь его в ?v= в index.html.
Без пересборки правки в модулях на сайт не попадут: index.html
подключает только бандл.

## Тесты (без зависимостей)
    node _test_model.js    # TicketModel: веса, индексы, группировка
    node _test_phase.js    # фазовая машина и верификация снимка
    node _test_anim.js     # физика: посадка, непрерывность скорости
    node _test_producer.cjs # снимок билетов: упаковка и разворот

## Тесты и превью с рендером (нужен npm install)
    node _test_render.js   # рендерер headless
    node _test_bundle.js   # собранный бандл целиком: инициализация и посадка
    node _preview_v2.js    # PNG-превью колеса
