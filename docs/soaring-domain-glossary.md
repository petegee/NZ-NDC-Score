# RC Soaring Competitions — Key Concepts

Several times a year, national radio-controlled soaring competitions take place. Pilots compete individually against each other in a "man-on-man" format: flying in small groups, with scores normalised within each group so that changing weather and luck-of-the-draw conditions don't decide the result. Over the course of a competition, every competitor flies a sequence of tasks across a series of rounds; at the end, normalised scores are totalled and placings awarded from first to last. The concepts below describe how such a competition is structured, and why.

## Competition Class

A competition class is the rulebook for a type of contest. It defines the phases a contest runs through, which task or tasks are flown in each, what is measured on every flight and to what precision, how competitors are grouped, which penalties can apply, and how raw measurements are turned into scores and placings. Well-known classes carry an FAI designation; a club may also author its own. The class exists so that every contest of the same type — anywhere, run by anyone — is flown and scored the same way. Everything that differs between one type of contest and another lives here and nowhere else: the rest of the system reads a class without ever knowing which one it is.

## Phase Definition

A phase definition is the class's description of one phase: which tasks may be flown in it, how long the working time is, how results are aggregated, how many rounds make it valid, and — for any phase after the first — which competitors are promoted into it from the one before. A class is an ordered list of phase definitions, of which the preliminary phase is simply the first. They exist because a flyoff is not merely a shorter preliminary: classes routinely change the working time, the points cap, the tasks available, and even whether penalties carry across. Keeping each phase's rules with the phase is what stops those differences leaking into the rest of the system.

## Parameter

A parameter is a value a class declares but deliberately does not fix, to be chosen for each competition. Some are settled when the contest is set up, some the day before flying from the measured conditions, some round by round, and some in the moment by the Contest Director. The class defines what may vary and within what bounds; the competition records what was actually chosen, and when. Parameters exist so that a legitimate local choice — a working time, a height reference, the size of a flyoff — does not require a separate rulebook for every combination.

## Score Term

A score term is one piece of the arithmetic that turns a flight's measurements into points: so many points per second up to a cap, a table lookup from a measured distance, a rate that changes across bands, a fixed value, or any of these applied only when some condition holds. A task's score is built by composing terms. Terms exist so the system can carry out a class's arithmetic without knowing what the numbers mean — a landing table and a launch-height penalty are the same kind of term reading different measurements, which is why the scoring process needs no notion of landings or launch heights at all.

## Competition

A competition is one actual event: a specific class, held at a specific location, over one or more days (typically one or two), with a specific set of pre-registered competitors drawn from everyone registered in the system. It is where the class's rules meet real pilots and real weather. When it ends, competitors are placed from first to last by total score.

## Person

A person is anyone registered in the system, with a name, contact details — email, phone, home city — and a club affiliation: club name and membership number. Registering with the system happens once. It is what makes someone known, so that an organiser can build a competition's field from known people. A person is role-agnostic: the same person may compete at one event and organise or officiate at another. Contact details live here and only here — competitions reference a person, they never copy them.

## Competitor

A competitor is one person's participation in one competition. It is created when the organiser registers a person into the competition, and carries what that participation needs: a competitor number and a record of when they registered — and, if it comes to that, when they withdrew. The field is frozen when the draw is accepted: a competitor who pulls out before then is simply removed, while one who withdraws afterwards stays in the draw and simply doesn't fly — and adding anyone after acceptance means redrawing. Competitors do double duty: when they are not flying, they help run the contest — timing the pilots who are in the air, collecting flight results, retrieving winch lines. A contest can only run if enough competitors are free of flying duties at any moment to do this official work, and that fact shapes how the field is divided up.

## Scoring Team

A competition-scoped named team, defined for one competition, whose members' individual results may contribute to that competition's team classification. Never inferred from a person's club, nationality, or any other person-level fact.

## Phase

A phase is a stage of a competition with its own field of competitors. Every competition has a preliminary phase in which everyone flies. Some classes then run a flyoff: a short additional phase for the top-placed pilots, with its own draw and its own scoring, which decides the final podium.

## Task

A task is a defined flying challenge: what the pilot must do, and what gets measured. Examples include flying for a target duration and landing precisely, covering as many distance legs as possible in a time window, or completing a speed course as fast as possible. Some classes have a single task flown repeatedly; others have a set of different tasks that every competitor must fly.

## Round

A round is one complete cycle of the competition: every competitor gets the chance to fly every task the class requires for that cycle. In single-task classes, a round is simply everyone flying the task once. In complex multi-task classes, a round is only complete when every competitor has flown the full set of tasks. Rounds are the yardstick of the competition: they determine whether a contest is valid (a minimum number must be flown), and they are usually the unit counted when the rules allow a worst score to be dropped — though some classes discard per task instead, dropping a competitor's weakest result in each task rather than their weakest round.

## Task-Round

A task-round is one task, flown once by the entire field, divided across groups. It is the everyday working unit of a contest — what people mean when they say "Round 2, Distance". In single-task classes a round contains exactly one task-round, so the two words are used interchangeably; in complex multi-task classes a round contains several. Task-rounds do not have to be flown in round order: organisers often sequence them for practical reasons, such as flying all of one task for the day before switching to the next, so pilots aren't repeatedly re-configuring their aircraft.

## Spot

A spot is a competitor's designated physical field position within a group for a task-round — a lane, launch spot, landing spot or winch line as the venue arranges them. Spots are explicit data, never implied by draw sequence; the field layout itself lives outside Soarscore.

## Draw

The draw is the allocation of competitors into groups for the whole competition. It is pseudo-random, but with a purpose: to ensure every competitor faces every other competitor an equal number of times — or as close to equal as possible — so that no one's result depends on who they happened to be grouped with. A draw is produced at the start of the competition from the registered competitors, and can be accepted or rejected and redrawn. Once accepted, the competition can begin.

## Group

A group is the subset of competitors who fly a task at the same moment. Groups exist for two reasons. First, fairness: everyone in a group flies in the same air at the same time, so their results can be honestly compared and normalised against each other. Second, practicality: keeping the group smaller than the full field leaves enough competitors free to act as officials. Some tasks are the exception — a speed task is typically flown as one group of the entire field, each pilot flying individually against the clock.

## Entry

An entry is one competitor's turn within a group: a single working-time window in which to fly the task. Normally a competitor has one entry per task-round. If a pilot suffers interference beyond their control — a mid-air collision, a launch problem — they may be granted a reflight, which is a second entry, flown either with a later group or in a dedicated reflight group. Which of a competitor's entries counts toward their score is decided by the class rules or, where the class rules are silent, by the Contest Director's recorded ruling. A re-flight flown with a later round's group may count for the competitor's missed round rather than the round it was flown in: the entry records that counts-for round, its score aggregates into the missed round's ladder slot, and it still normalises within the group that hosted it.

## Flight

A flight is a single launch through to a landing. In most classes a competitor makes one flight per entry. In hand-launch classes such as F3K and F5K, a single entry contains many flights — the pilot launches, flies, lands and relaunches repeatedly within the working time, and each flight is recorded. A flight is the smallest thing the competition measures.

## Measurement

Measurements are the raw facts captured from a flight: flight times, launch heights, landing distances, and whatever else the class calls for. Not all of them are numbers — some are plain observations, such as whether the model landed in the defined area or whether the model was touched during landing — and some are declarations the pilot makes *before* launching, such as the target time nominated in a Poker task, which the class rules then test the flight against. They are recorded exactly as captured and never altered — if a mistake is found, a correction is recorded alongside the original rather than overwriting it. Keeping the raw record untouched means results can always be verified, disputes can be settled from the evidence, and scores can be recalculated at any time.

## Reading Scale

A reading scale is the graduated instrument a landing was measured with — e.g. one side of the club's standard landing tape. It maps each exact mark reading to the distance band that mark stands for; it awards nothing. The class's own landing table turns the band into points. Scales exist because the observation (which mark) and the award (what the mark is worth under this class's rules) are two different facts: the same reading scores differently under different classes, and the same landing scores identically whether read off a declared scale or measured in metres. A competition declares which scales it used; each measurement names the scale it was read on, or none if it was measured directly.

## Assumed Value

An assumed value is what a metric declared by the competition class resolves to when a flight records no measurement for it — the class's statement of what absence means. It encodes how contest scoring is actually observed: officials record exceptions, not compliance — the out-of-bounds landing, the touched model, the overfly — so a clean flight is recorded as its measurements only, and the declared assumption makes that absence informative rather than an error. Explicit capture always wins: a recorded measurement, or a correction to one, is an observation and displaces the assumption; absence is the only trigger. The assumption is declared in the class beside the metric it belongs to and must be the same kind of value the metric is — an observation for an observation, a number for a number. It is interpreted when scores are computed, never captured as though it were a measurement, so the raw record stays honest: it holds what was actually observed, and nothing else.


## Penalty

A penalty is a recorded infraction of the rules — an over-height launch, a safety-line violation, a launch infraction. A penalty is attached to whatever it happened to: a particular flight, an entry, or the competition as a whole. The penalty itself only records what occurred; what it costs, and where the cost is applied, is defined by the class rules. A class states what each penalty it defines costs, and may also state the scope or scopes at which that infraction may be recorded — declaring it, say, a flight-level fact — and the system then refuses to record it anywhere else. A penalty the class does not restrict may be recorded at any scope.

## Score

Scores are computed, not captured. A separate scoring process takes the raw measurements and applies the class rules: interpreting each entry's flights into a task result, normalising results within each group (the best in the group typically earning 1000 points, the rest in proportion), applying penalties, dropping the permitted worst scores, and totalling everything into final placings. Because scoring works only from the raw record and the rules, it can be re-run at any time — after a protest, a correction, or a rules query — and will produce the same placings from the same facts. Scores are derived on demand throughout a competition; at finalisation they are additionally captured as a record of what was declared, which never displaces the raw record as the source of truth.

A result is not always a number. A flight that was never validly completed has *no result at all*, which is not the same as a result of zero: in a task where the fastest time wins, a zero would otherwise win the group outright. A competitor with no result scores nothing for that task, is ignored when deciding who won the group, and — if too few valid results remain — the group's result is annulled altogether.

