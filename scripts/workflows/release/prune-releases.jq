# 消す自動リリースのタグ名を、1 行に 1 つ出す。gh release list --json tagName,createdAt の出力を読む。
# build- で始まるリリースを新しいものから $ENV.KEEP 個だけ残し、それより古いものを返す。
# v で始まる正式なリリースは、数えず、返さない。
[.[] | select(.tagName | startswith("build-"))]
| sort_by(.createdAt)
| reverse
| .[($ENV.KEEP | tonumber):]
| .[].tagName
