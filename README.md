# Keitaro Flow

Веб-приложение для создания и редактирования кампаний Keitaro. Стек: **MongoDB, Express, React, Node.js**.

## Возможности

- Создание кампании с гео-потоком на Google и оффер-потоком.
- Управление потоками и статистикой офферов.
- Деактивация оффера без потери локальной записи и восстановление его прежней доли.
- Закрепление процента оффера: при перераспределении меняются только незакреплённые доли.
- Если оффер удалён из Keitaro, он остаётся в приложении неактивным. Его можно активировать после восстановления в Keitaro.
- Журнал изменений и локальные данные кампаний хранятся в MongoDB.
- Импорт существующих журналов из SQLite.

Неактивные офферы остаются в MongoDB, а в Keitaro для доступных офферов передаётся доля 0%. При удалении оффера из каталога Keitaro ссылка на него очищается из потока, но локальная запись и последняя доля сохраняются.

## Запуск

Требуется Node.js 22.12+ и MongoDB.

```bash
npm ci
npm --prefix server ci
npm --prefix client ci
cp .env.example .env
# Заполните KEITARO_BASE_URL и KEITARO_API_KEY
npm run dev
```

Откройте Vite-адрес, отображённый в терминале (по умолчанию http://localhost:5173). Express API работает на http://localhost:3000.

Для production:

```bash
npm run build
npm start
```

Express отдаёт собранный React-клиент из `client/dist`.

## Перенос данных из SQLite

Скрипт копирует `campaign_records` и `offer_changes` в MongoDB, восстанавливает связи офферов из журналов и сохраняет офферы, отсутствующие в последнем снимке, как неактивные. Он не меняет и не удаляет исходную SQLite-БД; повторный запуск безопасен.

```bash
npm run import:sqlite -- ./app.db
```

Замените `./app.db` на фактический путь к старой базе, если она находится в другом месте, например `npm run import:sqlite -- "/Users/you/backup/old-app.db"`. Путь `/path/to/app.db` — лишь пример и такой файл обычно не существует. Если это новая установка и старой SQLite-базы нет, пропустите импорт. Связи, которых нет в SQLite-журнале, будут синхронизированы из Keitaro при первом открытии кампании. Старый SQLite-формат не хранил признак закрепления, поэтому импортированные доли изначально не закреплены.

## Настройки

| Переменная | Назначение |
|---|---|
| `PORT` | Порт Express API (по умолчанию `3000`) |
| `MONGODB_URI` | URI MongoDB |
| `KEITARO_BASE_URL` | Адрес Keitaro |
| `KEITARO_API_KEY` | Ключ Keitaro Admin API |
| `NAME_PREFIX` | Префикс названия кампании; по умолчанию `test_kashkarbaev_` |
| `DEFAULT_GROUP_NAME` / `DEFAULT_SOURCE_NAME` | Значения по умолчанию для новых кампаний |
| `DEFAULT_DOMAIN` | Домен по умолчанию; если домен в Keitaro один, он выбирается автоматически |
| `GOOGLE_URL` | URL для гео-потока |
| `KEITARO_TIMEOUT` | Таймаут запросов к Keitaro в миллисекундах |

API-ключ хранится только в `.env`, не в клиентском приложении.

### Где взять Keitaro API key

Войдите в административную панель Keitaro, откройте меню профиля и перейдите в **Профиль → API-ключи**. Создайте ключ для приложения и скопируйте его в `KEITARO_API_KEY` в `.env`. Не публикуйте ключ и не добавляйте `.env` в Git.

`KEITARO_BASE_URL` — адрес вашей панели Keitaro, например `https://your-tracker.example`. Значение `https://tlgk.host` корректно только если именно по этому адресу открывается ваша панель. Приложение само добавляет `/admin_api/v1`; если адрес панели заканчивается на `/admin`, этот суффикс можно оставить или убрать.

## API

| Метод | URL | Назначение |
|---|---|---|
| GET | `/api/health` | Проверка состояния |
| GET | `/api/meta` | Домены, группы, источники и значения по умолчанию |
| GET | `/api/offers?q=` | Поиск офферов |
| POST | `/api/campaigns` | Создать кампанию |
| GET | `/api/campaigns?q=` | Список кампаний |
| GET | `/api/campaigns/:id?interval=today` | Кампания, потоки и статистика |
| POST | `/api/campaigns/:id/streams/:sid/offers` | Добавить или восстановить оффер |
| PATCH | `/api/campaigns/:id/streams/:sid/offers/:oid` | Переключить `active`, `pinned` или долю `share` |
| DELETE | `/api/campaigns/:id/streams/:sid/offers/:oid` | Совместимый endpoint деактивации |
| PUT | `/api/campaigns/:id/streams/:sid/offers` | Задать доли активных офферов |
| GET | `/api/debug/stream/:sid` | Сырой ответ Keitaro по потоку |

## Проверки

```bash
npm test
npm run build
```

Если при `npm run dev` появится ошибка о недостающем файле внутри `node_modules` (например, `rxjs/dist/cjs/index.js`), последовательно, не параллельно, переустановите зависимости командами `npm ci`, `npm --prefix server ci` и `npm --prefix client ci`.
