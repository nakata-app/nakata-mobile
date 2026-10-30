# WebKit checks for the app page

Real WebKit at iPhone 14 size against local mocks (no network, no device).

```sh
pip install playwright && python3 -m playwright install webkit
python3 -I test/webkit/ui_check.py        # chat, mascot, Markdown, free model
python3 -I test/webkit/native_check.py    # app feel: keyboard, zoom, swipes, haptics, links
python3 -I test/webkit/account_check.py   # nakata.app account, images, account deletion
```

Each exits non-zero on a failure. What they cannot show: the real keyboard,
safe areas and anything else only a device has.
