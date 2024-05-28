# telegram bot

## Installation

### Setting api link AWS-telegram

curl \
 --request POST \
 --url https://api.telegram.org/bot botToken/setWebhook \
 --header 'content-type: application/json' \
 --data '{"url": "API gateway domain/function"}'
