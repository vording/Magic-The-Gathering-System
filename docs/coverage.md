# 旧枠モダンの自動処理の対応状況

全1016種類：すべて自動 852（83.9%）・一部だけ 49・できない 115（2026-11-05 時点。`node tools/coverage.js --write` で更新）

## 読み取れない文があるカード

| カード | 読み取れない文 |
|---|---|
| Abundance | If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order. |
| Academy Researchers | When this enters, you may put an Aura card from your hand onto the battlefield attached to this. |
| Agonizing Memories | Look at target player's hand and choose two cards from it. Put them on top of that player's library in any order. |
| Arena | {3}, {T}: Tap target creature you control and target creature of an opponent's choice they control. Those creatures fight each other. |
| Arrest | Enchanted creature can't attack or block, and its activated abilities can't be activated. |
| Assault // Battery | Assault deals 2 damage to any target. |
| Aura Graft | Gain control of target Aura that's attached to a permanent. Attach it to another permanent it can enchant. |
| Avatar of Hope | If you have 3 or less life, this costs {6} less to cast. |
| Avatar of Might | If an opponent controls at least four more creatures than you, this costs {6} less to cast. |
| Avatar of Woe | If there are ten or more creature cards total in all graveyards, this costs {6} less to cast. |
| Avoid Fate | Counter target instant or Aura spell that targets a permanent you control. |
| Balance of Power | If target opponent has more cards in hand than you, draw cards equal to the difference. |
| Baleful Stare | Target opponent reveals their hand. You draw a card for each Mountain and red card in it. |
| Battle of Wits | At the beginning of your upkeep, if you have 200 or more cards in your library, you win the game. |
| Battle Screech | Flashback—Tap three untapped white creatures you control. |
| Biorhythm | Each player's life total becomes the number of creatures they control. |
| Blackmail | Target player reveals three cards from their hand and you choose one of them. That player discards that card. |
| Blinding Angel | Whenever this deals combat damage to a player, that player skips their next combat phase. |
| Booby Trap | As this enters, choose an opponent and a card name other than a basic land card name.<br>The chosen player reveals each card they draw.<br>When the chosen player draws a card with the chosen name, sacrifice this. If you do, this deals 10 damage to that player. |
| Braids, Cabal Minion | At the beginning of each player's upkeep, that player sacrifices an artifact, creature, or land of their choice. |
| Bribery | Search target opponent's library for a creature card and put that card onto the battlefield under your control. Then that player shuffles. |
| Browbeat | Any player may have this deal 5 damage to them. If no one does, target player draws three cards. |
| Brown Ouphe | {1}{G}, {T}: Counter target activated ability from an artifact source. |
| Call of the Wild | {2}{G}{G}: Reveal the top card of your library. If it's a creature card, put it onto the battlefield. Otherwise, put it into your graveyard. |
| Call to the Grave | At the beginning of each player's upkeep, that player sacrifices a non-Zombie creature of their choice.<br>At the beginning of the end step, if no creatures are on the battlefield, sacrifice this. |
| Celestial Dawn | Lands you control are Plains.<br>Nonland permanents you control are white. The same is true for spells you control and nonland cards you own that aren't on the battlefield.<br>You may spend white mana as though it were mana of any color. You may spend other mana only as though it were colorless mana. |
| Cephalid Constable | Whenever this deals combat damage to a player, return up to that many target permanents that player controls to their owner's hand. |
| Chance Encounter | Whenever you win a coin flip, put a luck counter on this.<br>At the beginning of your upkeep, if this has ten or more luck counters on it, you win the game. |
| Coalition Victory | You win the game if you control a land of each basic land type and a creature of each color. |
| Coat of Arms | Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it. |
| Conspiracy | Creatures you control are the chosen type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield. |
| Cowardice | Whenever a creature becomes the target of a spell or ability, return that creature to its owner's hand. |
| Cursed Totem | Activated abilities of creatures can't be activated. |
| Death Pits of Rath | Whenever a creature is dealt damage, destroy it. It can't be regenerated. |
| Defense Grid | Each spell costs {3} more to cast except during its controller's turn. |
| Defiant Vanguard | When this blocks, at end of combat, destroy it and all creatures it blocked this turn.<br>{5}, {T}: Search your library for a Rebel permanent card with mana value 4 or less, put it onto the battlefield, then shuffle. |
| Deflection | Change the target of target spell with a single target. |
| Desolation Giant | When this enters, destroy all other creatures you control. If it was kicked, destroy all other creatures instead. |
| Detonate | Destroy target artifact with mana value X. It can't be regenerated. this deals X damage to that artifact's controller. |
| Dingus Egg | Whenever a land is put into a graveyard from the battlefield, this deals 2 damage to that land's controller. |
| Disintegrate | this deals X damage to any target. If it's a creature, it can't be regenerated this turn, and if it would die this turn, exile it instead. |
| Distorting Lens | {T}: Target permanent becomes the color of your choice until end of turn. |
| Dodecapod | If a spell or ability an opponent controls causes you to discard this, put it onto the battlefield with two +1/+1 counters on it instead of putting it into your graveyard. |
| Dragon Mage | Whenever this deals combat damage to a player, each player discards their hand, then draws seven cards. |
| Dragon Whelp | {R}: this gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice this at the beginning of the next end step. |
| Elvish Bard | All creatures able to block this do so. |
| Enduring Renewal | Play with your hand revealed.<br>If you would draw a card, reveal the top card of your library instead. If it's a creature card, put it into your graveyard. Otherwise, draw a card.<br>Whenever a creature is put into your graveyard from the battlefield, return it to your hand. |
| Essence Sliver | Whenever a Sliver deals damage, its controller gains that much life. |
| Evil Eye of Orms-by-Gore | Non-Eye creatures you control can't attack. |
| Exhaustion | Creatures and lands target opponent controls don't untap during their next untap step. |
| Faceless Butcher | When this enters, exile another target creature.<br>When this leaves the battlefield, return the exiled card to the battlefield under its owner's control. |
| Feldon's Cane | {T}, Exile this: Shuffle your graveyard into your library. |
| Final Punishment | Target player loses life equal to the damage already dealt to that player this turn. |
| Fire // Ice | Fire deals 2 damage divided as you choose among one or two targets. |
| Fireball | this costs {1} more to cast for each target beyond the first.<br>this deals X damage divided evenly, rounded down, among any number of targets. |
| Fledgling Dragon | Threshold — As long as there are seven or more cards in your graveyard, this gets +3/+3 and has "{R}: this gets +1/+0 until end of turn." |
| Form of the Dragon | At the beginning of each end step, your life total becomes 5. |
| Future Sight | Play with the top card of your library revealed.<br>You may play lands and cast spells from the top of your library. |
| Gaea's Blessing | Target player shuffles up to three target cards from their graveyard into their library.<br>When this is put into your graveyard from your library, shuffle your graveyard into your library. |
| Gaea's Liege | As long as this isn't attacking, its power and toughness are each equal to the number of Forests you control. As long as this is attacking, its power and toughness are each equal to the number of Forests defending player controls.<br>{T}: Target land becomes a Forest until this leaves the battlefield. |
| Genesis | At the beginning of your upkeep, if this is in your graveyard, you may pay {2}{G}. If you do, return target creature card from your graveyard to your hand. |
| Giant Oyster | You may choose not to untap this during your untap step.<br>{T}: For as long as this remains tapped, target tapped creature doesn't untap during its controller's untap step, and at the beginning of each of your draw steps, put a -1/-1 counter on that creature. When this leaves the battlefield or becomes untapped, remove all -1/-1 counters from the creature. |
| Gift of Estates | If an opponent controls more lands than you, search your library for up to three Plains cards, reveal them, put them into your hand, then shuffle. |
| Goblin Snowman | {T}: this deals 1 damage to target creature it's blocking. |
| Gorilla Shaman | {X}{X}{1}: Destroy target noncreature artifact with mana value X. |
| Grinning Totem | {2}, {T}, Sacrifice this: Search target opponent's library for a card and exile it. Then that player shuffles. Until the beginning of your next upkeep, you may play that card. At the beginning of your next upkeep, if you haven't played it, put it into its owner's graveyard. |
| Ground Seal | Cards in graveyards can't be the targets of spells or abilities. |
| Guerrilla Tactics | When a spell or ability an opponent controls causes you to discard this, it deals 4 damage to any target. |
| Haunting Echoes | Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles. |
| Head Games | Target opponent puts the cards from their hand on top of their library. Search that player's library for that many cards. The player puts those cards into their hand, then shuffles. |
| High Ground | Each creature you control can block an additional creature each combat. |
| Honorable Passage | The next time a source of your choice would deal damage to any target this turn, prevent that damage. If damage from a red source is prevented this way, this deals that much damage to the source's controller. |
| Imaginary Pet | At the beginning of your upkeep, if you have a card in hand, return this to its owner's hand. |
| Inflame | this deals 2 damage to each creature dealt damage this turn. |
| Jester's Cap | {2}, {T}, Sacrifice this: Search target player's library for three cards and exile them. Then that player shuffles. |
| Karplusan Yeti | {T}: this deals damage equal to its power to target creature. That creature deals damage equal to its power to this. |
| Kjeldoran Royal Guard | {T}: All combat damage that would be dealt to you by unblocked creatures this turn is dealt to this instead. |
| Lavaborn Muse | At the beginning of each opponent's upkeep, if that player has two or fewer cards in hand, this deals 3 damage to that player. |
| Legacy Weapon | If this would be put into a graveyard from anywhere, reveal this and shuffle it into its owner's library instead. |
| Leviathan | this enters tapped and doesn't untap during your untap step.<br>At the beginning of your upkeep, you may sacrifice two Islands. If you do, untap this.<br>this can't attack unless you sacrifice two Islands. |
| Living Terrain | Enchanted land is a 5/6 green Treefolk creature that's still a land. |
| Llanowar Sentinel | When this enters, you may pay {1}{G}. If you do, search your library for a card named this, put that card onto the battlefield, then shuffle. |
| Lord of the Pit | At the beginning of your upkeep, sacrifice a creature other than this. If you can't, this deals 7 damage to you. |
| Lure | All creatures able to block enchanted creature do so. |
| Mana Clash | You and target opponent each flip a coin. this deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip. |
| Meddling Mage | As this enters, choose a nonland card name.<br>Spells with the chosen name can't be cast. |
| Meltdown | Destroy each artifact with mana value X or less. |
| Merieke Ri Berit | {T}: Gain control of target creature for as long as you control this. When this leaves the battlefield or becomes untapped, destroy that creature. It can't be regenerated. |
| Midnight Ritual | Exile X target creature cards from your graveyard. For each creature card exiled this way, create a 2/2 black Zombie creature token. |
| Mind Bend | Change the text of target permanent by replacing all instances of one color word with another or one basic land type with another. |
| Mirari | Whenever you cast an instant or sorcery spell, you may pay {3}. If you do, copy that spell. You may choose new targets for the copy. |
| Mogg Salvage | If an opponent controls an Island and you control a Mountain, you may cast this without paying its mana cost. |
| Mortal Combat | At the beginning of your upkeep, if twenty or more creature cards are in your graveyard, you win the game. |
| Murderous Betrayal | {B}{B}, Pay half your life, rounded up: Destroy target nonblack creature. It can't be regenerated. |
| Nantuko Cultivator | When this enters, you may discard any number of land cards. Put that many +1/+1 counters on this and draw that many cards. |
| Nether Spirit | At the beginning of your upkeep, if this is the only creature card in your graveyard, you may return this to the battlefield. |
| No Rest for the Wicked | Sacrifice this: Return to your hand all creature cards in your graveyard that were put there from the battlefield this turn. |
| Nomad Mythmaker | {W}, {T}: Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control. |
| Okk | this can't attack unless a creature with greater power also attacks.<br>this can't block unless a creature with greater power also blocks. |
| Oracle's Attendants | {T}: All damage that would be dealt to target creature this turn by a source of your choice is dealt to this instead. |
| Orcish Librarian | {R}, {T}: Look at the top eight cards of your library. Exile four of them at random, then put the rest on top of your library in any order. |
| Orgg | this can't attack if defending player controls an untapped creature with power 3 or greater. |
| Orim's Chant | Target player can't cast spells this turn. If this was kicked, creatures can't attack this turn. |
| Ovinomancer | When this enters, sacrifice it unless you return three basic lands you control to their owner's hand.<br>{T}, Return this to its owner's hand: Destroy target creature. It can't be regenerated. That creature's controller creates a 0/1 green Sheep creature token. |
| Pandemonium | Whenever a creature enters, that creature's controller may have it deal damage equal to its power to any target of their choice. |
| Patriarch's Bidding | Each player chooses a creature type. Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield. |
| Pay No Heed | Prevent all damage a source of your choice would deal this turn. |
| Pendelhaven | {T}: Target 1/1 creature gets +1/+2 until end of turn. |
| Persecute | Choose a color. Target player reveals their hand and discards all cards of that color. |
| Phage the Untouchable | When this enters, if you didn't cast it from your hand, you lose the game.<br>Whenever this deals combat damage to a creature, destroy that creature. It can't be regenerated.<br>Whenever this deals combat damage to a player, that player loses the game. |
| Plagiarize | Until end of turn, if target player would draw a card, instead that player skips that draw and you draw a card. |
| Polymorph | Destroy target creature. It can't be regenerated. Its controller reveals cards from the top of their library until they reveal a creature card. The player puts that card onto the battlefield, then shuffles all other cards revealed this way into their library. |
| Primal Clay | As this enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types. |
| Prohibit | Counter target spell if its mana value is 2 or less. If this was kicked, counter that spell if its mana value is 4 or less instead. |
| Propaganda | Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you. |
| Quirion Dryad | Whenever you cast a spell that's white, blue, black, or red, put a +1/+1 counter on this. |
| Relentless Assault | Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase. |
| Reverse Damage | The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain life equal to the damage prevented this way. |
| Rootwater Matriarch | {T}: Gain control of target creature for as long as that creature is enchanted. |
| Sacred Ground | Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield. |
| Safe Haven | At the beginning of your upkeep, you may sacrifice this. If you do, return each card exiled with this to the battlefield under its owner's control. |
| Sanctum Guardian | Sacrifice this: The next time a source of your choice would deal damage to any target this turn, prevent that damage. |
| Scalpelexis | Whenever this deals combat damage to a player, that player exiles the top four cards of their library. If two or more of those cards have the same name, repeat this process. |
| Scoria Wurm | At the beginning of your upkeep, flip a coin. If you lose the flip, return this to its owner's hand. |
| Sengir Autocrat | When this leaves the battlefield, exile all Serf tokens. |
| Serra Avatar | When this is put into a graveyard from anywhere, shuffle it into its owner's library. |
| Shifting Sky | All nonland permanents are the chosen color. |
| Sindbad | {T}: Draw a card and reveal it. If it isn't a land card, discard it. |
| Solitary Confinement | Skip your draw step.<br>Prevent all damage that would be dealt to you. |
| Soul Collector | Whenever a creature dealt damage by this this turn dies, return that card to the battlefield under your control. |
| Spell Blast | Counter target spell with mana value X. |
| Spined Sliver | Whenever a Sliver becomes blocked, that Sliver gets +1/+1 until end of turn for each creature blocking it. |
| Spitting Slug | Whenever this blocks or becomes blocked, you may pay {1}{G}. If you do, this gains first strike until end of turn. Otherwise, each creature blocking or blocked by this gains first strike until end of turn. |
| Sterling Grove | {1}, Sacrifice this: Search your library for an enchantment card, reveal it, then shuffle and put that card on top. |
| Stone Giant | {T}: Target creature you control with toughness less than this's power gains flying until end of turn. Destroy that creature at the beginning of the next end step. |
| Storage Matrix | As long as this is untapped, each player chooses artifact, creature, or land during their untap step. That player can untap only permanents of the chosen type this step. |
| Sutured Ghoul | As this enters, exile any number of creature cards from your graveyard.<br>this's power is equal to the total power of the exiled cards and its toughness is equal to their total toughness. |
| Swamp Mosquito | Whenever this attacks and isn't blocked, defending player gets a poison counter. |
| Teferi's Puzzle Box | At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards. |
| Telepathy | Your opponents play with their hands revealed. |
| The Rack | As this enters, choose an opponent.<br>At the beginning of the chosen player's upkeep, this deals X damage to that player, where X is 3 minus the number of cards in their hand. |
| Thieves' Auction | Exile all nontoken permanents. Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control. Repeat this process until all cards exiled this way have been chosen. |
| Thornscape Battlemage | When this enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.<br>When this enters, if it was kicked with its {W} kicker, destroy target artifact. |
| Thrull Surgeon | {1}{B}, Sacrifice this: Look at target player's hand and choose a card from it. That player discards that card. Activate only as a sorcery. |
| Two-Headed Dragon | this can block an additional creature each combat. |
| Urza's Rage | this deals 3 damage to any target. If this was kicked, instead it deals 10 damage to that permanent or player and the damage can't be prevented. |
| Verdeloth the Ancient | Saproling creatures and other Treefolk creatures get +1/+1.<br>When this enters, if it was kicked, create X 1/1 green Saproling creature tokens. |
| Vexing Arcanix | {3}, {T}: Target player chooses a card name, then reveals the top card of their library. If that card has the chosen name, that player puts it into their hand. Otherwise, they put it into their graveyard and this deals 2 damage to them. |
| Vhati il-Dal | {T}: Until end of turn, target creature has base power 1 or base toughness 1. |
| Victimize | Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped. |
| Void | Choose a number. Destroy all artifacts and creatures with mana value equal to that number. Then target player reveals their hand and discards all nonland cards with mana value equal to the number. |
| Wall of Roots | Put a -0/-1 counter on this: Add {G}. Activate only once each turn. |
| War Barge | {3}: Target creature gains islandwalk until end of turn. When this leaves the battlefield this turn, destroy that creature. A creature destroyed this way can't be regenerated. |
| Warped Devotion | Whenever a permanent is returned to a player's hand, that player discards a card. |
| Weathered Wayfarer | {W}, {T}: Search your library for a land card, reveal it, put it into your hand, then shuffle. Activate only if an opponent controls more lands than you. |
| Weird Harvest | Each player may search their library for up to X creature cards, reveal those cards, put them into their hand, then shuffle. |
| Whirling Dervish | At the beginning of each end step, if this dealt damage to an opponent this turn, put a +1/+1 counter on it. |
| Willbender | When this is turned face up, change the target of target spell or ability with a single target. |
| Windborn Muse | Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you. |
| Withering Gaze | Target opponent reveals their hand. You draw a card for each Forest and green card in it. |
| Worldly Counsel | Domain — Look at the top X cards of your library, where X is the number of basic land types among lands you control. Put one of those cards into your hand and the rest on the bottom of your library in any order. |
| Yawgmoth Demon | At the beginning of your upkeep, you may sacrifice an artifact. If you don't, tap this and it deals 2 damage to you. |
| Zealous Inquisitor | {1}{W}: The next 1 damage that would be dealt to this this turn is dealt to target creature instead. |
| Zur's Weirding | Players play with their hands revealed.<br>If a player would draw a card, they reveal it instead. Then any other player may pay 2 life. If a player does, put that card into its owner's graveyard. Otherwise, that player draws a card. |
