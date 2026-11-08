# Demo decisions

The sample decisions in the README screenshots, for an imaginary office coffee-ordering app. The
screenshots themselves are pages in [screenshots/](screenshots/), drawn after the desktop app and
turned into PNGs by `screenshots/render.sh`, so they can be updated without a live session. To see
the same decisions in the real bar, paste one of these into a Claude Code session with the mod
installed.

For the bar, the box in the chat and the collapsed bar:

```
Put these demo decisions in the decision bar (language: en), in this order:
- Dark mode: Ship dark mode for the night shift. Options: "Tonight" with the text "Tonight, with celebrations till dawn.", and "When lightning strikes".
- Decaf: Show a gentle warning when someone orders their fifth espresso before noon.
- Auth: Let colleagues sign in with the company SSO. And reward them generously with... Options: Big bear hugs, High Fives, Carrot cake.
- Easter egg: Play a tiny trumpet sound for the thousandth order of the month.
```

In the screenshots: Tonight on Dark mode and the remark "Seven is fine. Be gentle." on Decaf. On
Auth, Big bear hugs in the bar and High Fives in the box, where Dark mode was already sent on its
own. Collapsed, Decaf is also disagreed with.

The same in Dutch, for the screenshot of the bar in another language, with the menu of Inloggen
open:

```
Zet deze demobeslissingen in de beslissingsbalk (language: nl), in deze volgorde:
- Donkere modus: Lever de donkere modus op voor de nachtdienst. Antwoorden: "Vanavond" met de tekst "Vanavond, met feest tot het ochtendgloren.", en "Als de bliksem inslaat".
- Cafeïnevrij: Toon een vriendelijke waarschuwing als iemand vóór de middag zijn vijfde espresso bestelt.
- Inloggen: Laat collega's inloggen met de SSO van het bedrijf. En beloon ze daar royaal voor met... Antwoorden: Dikke berenknuffels, High Fives, Worteltaart.
```

In the screenshot: Vanavond on Donkere modus, the remark "Zeven is prima. Be gentle." on
Cafeïnevrij, and Dikke berenknuffels on Inloggen, with its menu open.
