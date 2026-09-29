import { describe, expect, it } from 'vitest'
import type { ClassDefinition, TaskDefinition } from '../api/types'
import alesNdc from '../test/fixtures/81-nz-m-ndc.json'
import f3kNdc from '../test/fixtures/85b-nz-f3k-ndc.json'
import f3j from '../test/fixtures/50-f3j.json'
import f5jNdc from '../test/fixtures/85c-nz-f5j-ndc.json'
import radianNdc from '../test/fixtures/85-nz-p-radian.json'
import { deriveTaskGrid, exactZeroNoPointsMetrics, taskByRef } from './schema'

const ales = alesNdc as ClassDefinition
const f3k = f3kNdc as ClassDefinition
const f5j = f5jNdc as ClassDefinition
const radian = radianNdc as ClassDefinition
const f3jDef = f3j as ClassDefinition

/** A minimal Number-metric task carrying the given score terms — the shape
 * the derivation reads, without any class or metric-name fixture. */
function taskWithScore(score: TaskDefinition['score']): TaskDefinition {
  return {
    code: 'D',
    name: 'Duration',
    metrics: [{ name: 'landingDistance', kind: 'Number', unit: 'm', declaredBeforeLaunch: false }],
    flights: { $kind: 'last' },
    timing: { kind: 'Fixed', workingTime: 600 },
    score,
  } as TaskDefinition
}

describe('exactZeroNoPointsMetrics', () => {
  it('flags the landing metric on every mirrored landing-zero fixture task', () => {
    expect(deriveTaskGrid(taskByRef(ales, 'D')!).zeroHintMetrics).toEqual(['landingDistance'])
    expect(deriveTaskGrid(taskByRef(f5j, 'D')!).zeroHintMetrics).toEqual(['landingDistance'])
    expect(deriveTaskGrid(taskByRef(radian, 'D')!).zeroHintMetrics).toEqual(['landingDistance'])
    expect(deriveTaskGrid(taskByRef(f3jDef, 'D')!).zeroHintMetrics).toEqual(['landingDistance'])
  })

  it('finds the nested lookup inside the landing conditional (fly-off task)', () => {
    const flyoff = f3jDef.phases
      .flatMap((p) => p.tasks)
      .find((t) => t.name.includes('fly-off'))!
    expect(exactZeroNoPointsMetrics(flyoff)).toEqual(['landingDistance'])
  })

  it('leaves rate-only tasks hint-free (F3K catalogue)', () => {
    for (const ref of ['B', 'D', 'G', 'H']) {
      expect(deriveTaskGrid(taskByRef(f3k, ref)!).zeroHintMetrics).toEqual([])
    }
  })

  it('ignores a lookup whose first row awards points at exact zero', () => {
    const task = taskWithScore([
      {
        $kind: 'lookup',
        metricRef: 'landingDistance',
        rows: [
          { upTo: 1, points: 50 },
          { upTo: null, points: 0 },
        ],
      },
    ])
    expect(exactZeroNoPointsMetrics(task)).toEqual([])
  })

  it('ignores a leading zero row that still awards points', () => {
    const task = taskWithScore([
      {
        $kind: 'lookup',
        metricRef: 'landingDistance',
        rows: [
          { upTo: 0, points: 50 },
          { upTo: 1, points: 50 },
          { upTo: null, points: 0 },
        ],
      },
    ])
    expect(exactZeroNoPointsMetrics(task)).toEqual([])
  })

  it('reads string-form rows (number|string wire form) the same way', () => {
    const task = taskWithScore([
      {
        $kind: 'lookup',
        metricRef: 'landingDistance',
        rows: [
          { upTo: '0', points: '0' },
          { upTo: '1', points: '50' },
          { upTo: null, points: '0' },
        ],
      },
    ])
    expect(exactZeroNoPointsMetrics(task)).toEqual(['landingDistance'])
  })

  it('walks conditional else branches as well as then', () => {
    const task = taskWithScore([
      {
        $kind: 'conditional',
        when: {
          $kind: 'comparison',
          leftMetricRef: 'flightTime',
          op: 'LessThan',
          rightValue: { kind: 'Number', number: 600 },
        },
        then: { $kind: 'constant', value: 0 },
        else: {
          $kind: 'lookup',
          metricRef: 'landingDistance',
          rows: [{ upTo: 0, points: 0 }, { upTo: null, points: 0 }],
        },
      },
    ])
    expect(exactZeroNoPointsMetrics(task)).toEqual(['landingDistance'])
  })
})
