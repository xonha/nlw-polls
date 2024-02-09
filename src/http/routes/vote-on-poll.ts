import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { redis } from "../../lib/redis";
import { voting } from "../../utils/voting-pub-sub";

export async function voteOnPoll(app: FastifyInstance) {
  app.post("/poll/:pollId/vote", async (req, res) => {
    const voteOnPollBody = z.object({
      pollOptionId: z.string().uuid(),
    });

    const voteOnPollParams = z.object({
      pollId: z.string().uuid(),
    });

    const { pollId } = voteOnPollParams.parse(req.params);
    const { pollOptionId } = voteOnPollBody.parse(req.body);

    let { sessionId } = req.cookies;

    if (sessionId) {
      const userPreviousVote = await prisma.vote.findUnique({
        where: {
          sessionId_pollId: {
            pollId,
            sessionId,
          },
        },
      });
      if (userPreviousVote && userPreviousVote.pollOptionId !== pollOptionId) {
        await prisma.vote.delete({
          where: {
            id: userPreviousVote.id,
          },
        });

        const votes = await redis.zincrby(
          pollId,
          -1,
          userPreviousVote.pollOptionId,
        );

        voting.publish(pollId, {
          pollOptionId: userPreviousVote.pollOptionId,
          votes: Number(votes),
        });
      } else if (userPreviousVote) {
        return res.code(409).send({
          message: "You have already voted on this poll",
        });
      }
    }

    if (!sessionId) {
      sessionId = randomUUID();
      res.setCookie("sessionId", sessionId, {
        path: "/",
        httpOnly: true,
        signed: true,
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }
    await prisma.vote.create({
      data: {
        sessionId,
        pollOptionId,
        pollId,
      },
    });

    const votes = await redis.zincrby(pollId, 1, pollOptionId);

    voting.publish(pollId, { pollOptionId, votes: Number(votes) });

    return res.code(201).send({ sessionId });
  });
}
